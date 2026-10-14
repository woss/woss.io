# deploy/ — k8s manifests for woss.io

Self-owned manifests. On every merge to `main`, `.github/workflows/deploy.yml`
builds/pushes the image and applies `pvc.yaml service.yaml deployment.yaml
ingress.yaml` to the prod cluster (namespace `tools-img`), substituting the
pushed image digest for `__DIGEST__` in `deployment.yaml`.

Ported from kelp-infra `infra/modules/services-stack/wave2.tf` (which stopped
managing these objects after cutover). Keep the pod in `tools-img`: that
namespace's NetworkPolicies (default-deny + allow caddy/datadog/tools/mcl-db)
are what keep the pod reachable. Do not create a namespace manifest.

## Layout

| File              | Object                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `pvc.yaml`        | PVC `woss-data` (RWO 10Gi, `local-path`, state at `/app/data`)                              |
| `service.yaml`    | Service `woss` (3000→3000)                                                                  |
| `deployment.yaml` | Deployment `woss` + `build-index` init container                                            |
| `ingress.yaml`    | Ingress `woss` (caddy class, host `woss.io`) — no `tls:` block, caddy auto-ACME             |
| `rbac.yaml`       | CI ServiceAccount `woss-deployer` + Role/RoleBinding + token secret (operator-applied once) |

## Operator setup (already applied for prod; reapply RBAC after permission changes)

1. Apply RBAC with the **admin** kubeconfig (CI cannot grant rights):
   ```bash
   kubectl apply -f deploy/rbac.yaml
   ```
   Reapply this after Agent permissions change. It grants the deployer
   read/patch access to only the `datadog` Operator resource named `datadog`,
   so CI can enable OTLP log ingestion. The deploy workflow sets
   `DD_OTLP_CONFIG_LOGS_ENABLED=true` on the Agent container; this is separate
   from `features.logCollection.enabled`.
2. Assemble the CI kubeconfig (server + CA + SA token):
   ```bash
   SERVER=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')
   TOKEN=$(kubectl -n tools-img get secret woss-deployer-token -o jsonpath='{.data.token}' | base64 -d)
   CA=$(kubectl -n tools-img get secret woss-deployer-token -o jsonpath='{.data.ca\.crt}')
   kubectl config set-cluster kelp --server="$SERVER" --certificate-authority-data="$CA" --kubeconfig=./tmp/kubeconfig
   kubectl config set-credentials woss-deployer --token="$TOKEN" --kubeconfig=./tmp/kubeconfig
   kubectl config set-context woss-deployer --cluster=kelp --user=woss-deployer --namespace=tools-img --kubeconfig=./tmp/kubeconfig
   kubectl config use-context woss-deployer --kubeconfig=./tmp/kubeconfig
   ```
   Wait for the token secret to populate first (`kubectl -n tools-img get secret woss-deployer-token` shows a `token` key).
3. Upload the kubeconfig as a repo secret:
   ```bash
   base64 -w0 ./tmp/kubeconfig > ./tmp/kubeconfig.b64
   gh secret set KUBECONFIG_B64 -R woss/woss.io < ./tmp/kubeconfig.b64
   rm -rf ./tmp
   ```
4. Copy the app secrets from the cluster (values exist only in
   `tool-secrets`, ns `tools-img`; `WOSS_CLOUDFLARE_API_TOKEN` is NOT
   referenced by the deployment — skip it):
   ```bash
   for K in WOSS_PROVIDER_API_KEY WOSS_GITHUB_TOKEN WOSS_MCL_MCP_API_KEY WOSS_MCP_SERVERS \
            WOSS_USER_WEBHOOK_URL WOSS_USER_WEBHOOK_ERROR_URL WOSS_USER_WEBHOOK_TOKEN; do
     kubectl -n tools-img get secret tool-secrets -o jsonpath="{.data.$K}" | base64 -d \
       | gh secret set "$K" -R woss/woss.io
   done
   ```
   Pipe-based transfer avoids shell word-splitting of multi-line values
   (`WOSS_MCP_SERVERS` is multi-line JSON). Verify byte-length parity
   afterwards: `gh secret` input vs `kubectl ... | base64 -d | wc -c`.

## How deploys work

- CI creates/updates the `woss-secrets` Secret in `tools-img` from GitHub
  repo secrets (same `WOSS_*` key names), then pins the pushed digest and
  applies the four manifests, then waits for
  `kubectl -n tools-img rollout status deployment/woss --timeout=600s`
  (`build-index` runs vite-node and can take minutes).
- Secret changes take effect on the next rollout (each deploy rolls the pod
  with a new digest).
- Concurrency group `deploy-woss-prod` serializes deploys.
- Rollback to the previous image:
  `kubectl -n tools-img set image deployment/woss woss=<old digest-ref>` —
  edit `deploy/deployment.yaml` on top of that so the next deploy keeps it.
