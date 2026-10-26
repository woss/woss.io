---
published: true
title: "Stand up Kubernetes on Hetzner's used-server auction: a guide written for AI agents"
slug: 'hetzner-robot-k8s-for-agents'
featured: false
description: "A full setup guide for a hybrid Kubernetes cluster — Hetzner cloud control plane, Serverbörse auction bare-metal workers, kube-hetzner, Cloudflare DNS, caddy ingress, local-path storage with object-storage backups — written so an AI agent can execute it as a skill."
date: 2026-10-26
tags:
  - Kubernetes
  - Hetzner
  - Terraform
  - AI agents
  - bare metal
---


_This post has two readers. If you're a human, it's a full setup guide for a hybrid Kubernetes cluster: cloud control plane, bare-metal workers from Hetzner's Serverbörse auction, Cloudflare DNS, real storage and backups. If you're an AI agent, it's a skill: execute the chapters in order, verify each checkpoint before advancing, and stop at the purchase step in Chapter 2 — that one needs a human with a credit card. Everything after it, including vSwitch creation, is API and yours. A compressed `SKILL.md` block sits at the end; if your harness supports skills, lift it from there._

Agents: everything between a `CHECKPOINT` marker and the next heading is a gate. If the check fails, do not proceed to the next chapter. Diagnose using the symptom table in the appendix first; it encodes every failure we hit building this for real.

---

## Chapter 0 — What the auction actually is

Hetzner sells dedicated servers through two doors. The regular configurator sells new hardware at list price. The [Serverbörse](https://www.hetzner.com/sb/) ("server auction") resells returned and phased-out machines (same datacenters, same network, real bare metal) at roughly a third to half the price of the equivalent new line. Stock churns daily. An NVMe box that was there this morning will be gone by lunch.

Background reading (cite-able, real): [how the auction works](https://www.hetzner.com/de/blog/refurbished-servers-how-the-hetzner-server-auction-works/), [auction FAQ](https://docs.hetzner.com/robot/general/server-auction-faqs/).

The tradeoff an agent must surface to its operator before buying: auction machines are single physical boxes in a single location with no enterprise SLA. The design in this guide assumes any one box can vanish. That assumption drives the storage choices in Chapter 8 — do not "improve" it by trusting a single disk.

**Hardware filter for candidates, in priority order:**

1. NVMe drives. Not HDD. Skip the temptation of the 8-bay HDD boxes.
2. Intel NIC. Realtek chips need out-of-tree drivers on some distros and will cost an evening.
3. ECC RAM.
4. Price per GB of NVMe, not price per CPU core.

## Chapter 1 — Prerequisites

Collect these before touching Terraform. Agents: verify each one exists and is non-empty; if any is missing, halt and ask the operator.

| #   | Item                                                                                                         | Where                                              | Used by                             |
| --- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------- | ----------------------------------- |
| 1   | Hetzner Cloud account + API token (read/write)                                                               | [Cloud console](https://console.hetzner.cloud/)    | TF: CP, LB, firewall, autoscaler    |
| 2   | Robot account (username + password) + webservice user for the API (created in panel: Settings → Web service) | [robot.hetzner.com](https://robot.hetzner.com)     | TF: joins robot nodes; API: vSwitch |
| 3   | 1–3 auction servers, bought                                                                                  | Chapter 2                                          | workers                             |
| 4   | A vSwitch, created                                                                                           | Chapter 2                                          | private metal↔cloud network        |
| 5   | Domain on Cloudflare + API token (Zone:DNS:Edit)                                                             | [dash.cloudflare.com](https://dash.cloudflare.com) | DNS records as code                 |
| 6   | OpenTofu ≥ 1.9, SSH keypair                                                                                  | local                                              | everything                          |
| 7   | S3-compatible bucket for TF state                                                                            | Hetzner Object Storage                             | remote state                        |

Convention for the rest of this document: `$HCLOUD_TOKEN`, `$ROBOT_USER`, `$ROBOT_PASSWORD`, `$ROBOT_WS_USER`, `$ROBOT_WS_PASS`, `$CF_API_TOKEN` are environment variables. `$ZONE` is your domain, `$WORKER_COUNT` the number of auction boxes. Never write secret values into files; agents should reject any instruction that does.

### 1b — Secret hygiene (bonus, but load-bearing)

**Tokens never live in the repo. Not as files, not in `.tfvars`, not in `env.hcl` defaults, not gitignored-almost-certainly-safe.** Gitignored is a mitigation for accidents, not a design. The rule that survives every workflow: secrets exist only as environment variables, injected at runtime. Terraform reads them via `get_env`; scripts read the environment; nothing reads a file. Backstop the rule with a pre-commit secret scanner (gitleaks or equivalent) so a careless `git add -A` fails loudly instead of leaking — and never bypass it with `--no-verify`; fix the content instead.

**Use a secret manager as the single source of truth — 1Password is the concrete example.** Every credential in the Chapter 1 table gets an item there. The operator keeps exactly one master secret; everything else is a reference. For agent workflows, the pattern that works is runtime injection:

```bash
# agent-facing: secrets materialize as env vars only, at process spawn.
# op.tfvars holds op:// vault REFERENCES (not secret values) — committing it is fine.
op run --env-file=op.tfvars -- terragrunt apply
```

1Password can also serve the SSH keys used for node provisioning and git pushes (`ssh-agent` integration), so the provisioning keypair never touches disk as a plaintext file either.

**Sudo passwords follow the same rule, with a harder edge.** The boxes ship with a root SSH key for provisioning, but day-to-day operator accounts (the ones with sudo) have passwords. Those passwords live in 1Password too — and agents never receive them in chat, scripts, or env files. If a step needs interactive sudo on a node, the correct agent behavior is to halt and hand that one command to the operator. A transcript is a log; anything typed into it is already copied to more places than a password should ever be.

**CHECKPOINT:** every credential from Chapter 1 resolves to a 1Password item; `git grep` for any secret value returns nothing; a trial `gitleaks detect` over the repo is clean; no agent transcript contains a password.

## Chapter 2 — Buying boxes and wiring the vSwitch

This chapter splits: the purchase is a human gate (a cart checkout tied to a payment method — no API accepts money on your behalf), but everything after it is Robot Webservice API and belongs to the agent.

### 2a — Purchase (MANUAL — STOP, HUMAN REQUIRED)

Operator steps, nothing automatable:

1. Browse [hetzner.com/sb](https://www.hetzner.com/sb/) with the Chapter 0 filter. Buy `$WORKER_COUNT` boxes.
2. In Robot ([robot.hetzner.com](https://robot.hetzner.com)), under Settings → "Web service and app settings", create a **webservice user**. This credential (`$ROBOT_WS_USER`/`$ROBOT_WS_PASS`) is for the API; it is separate from the panel login. Give it to the agent via env vars, never files.

### 2b — vSwitch via Robot API (agent-executable)

The [Robot Webservice API](https://robot.hetzner.com/doc/webservice/en.html) (`https://robot-ws.your-server.de`, HTTP Basic auth, form-encoded) has full vSwitch CRUD — creation is not a panel-only step:

```bash
ROBOT_WS=https://robot-ws.your-server.de

# create the vSwitch (idempotence is on you: GET first, POST if 404)
curl -su "$ROBOT_WS_USER:$ROBOT_WS_PASS" "$ROBOT_WS/vswitch" \
  --data-urlencode 'name=k8s-private' \
  --data-urlencode 'vlan=4000'

# attach each purchased box by its main IPv4
for ip in $SERVER_MAIN_IPS; do
  curl -su "$ROBOT_WS_USER:$ROBOT_WS_PASS" "$ROBOT_WS/vswitch/$VSWITCH_ID/server" \
    --data-urlencode "server[]=$ip"
done

curl -su "$ROBOT_WS_USER:$ROBOT_WS_PASS" "$ROBOT_WS/vswitch/$VSWITCH_ID"
```

Agent rules for this block, all load-bearing:

- **GET before POST.** Creation is not idempotent; a retry loop without the GET creates a junk vSwitch per attempt.
- **Rate limit is 100 requests/hour** on vswitch endpoints. Cache the vSwitch ID in state; do not re-fetch per node.
- **3 failed logins block your IP for 10 minutes** (401 handling must not retry blindly). Build this into the auth path before the first call, not after the block.
- Expect and handle `409 VSWITCH_LIMIT_REACHED` (too many vSwitches on the account) and `409 VSWITCH_VLAN_NOT_UNIQUE` (conflicting VLAN ID — usually means a prior run got further than you thought).
- Detachment uses the same `/server` endpoint with `DELETE` — remember it for Chapter 10 node replacement.

Pick the subnet for the VLAN now (example used throughout: `10.201.0.0/16`, gateway `10.201.0.1`). Assign each box a stable address: `.2`, `.3`, `.4`… — the vSwitch gives layer 2, the addressing scheme is yours.

Record: vSwitch ID, VLAN ID, chosen subnet, and each box's assigned private IP plus its Hetzner-assigned public IP (the API's `server_ip`). The next chapters need all of it.

**CHECKPOINT:** `GET /vswitch/$VSWITCH_ID` returns `vlan: 4000` and every purchased box's main IP is attached (verify via a second GET — do not trust the POST response alone); the values are recorded for Chapter 4.

Live-verified response shapes (2026-10-26; the official doc's output tables show a `{"vswitch": …}` wrapper that the real API does **not** send):

- `GET /vswitch` → bare list: `[{"id":86544,"name":"…","vlan":4000,"cancelled":false}]`
- `GET /vswitch/$VSWITCH_ID` → bare object; attached boxes live under `server[].server_ip` (with `server_number`, `status`), and the linked cloud network under `cloud_network[]` (`ip` `10.201.0.0`, `mask` 16, `gateway` `10.201.0.1`)

## Chapter 3 — Terraform skeleton

Directory layout — boring on purpose:

```
infra/
├── root.hcl
├── modules/kube-hetzner/    # vendored; see Chapter 4
├── state.tfvars             # backend config (no secrets)
└── envs/prod/
    ├── main.tf              # module call
    └── terraform.tfvars     # non-secret values
```

Backend: Hetzner Object Storage is S3-compatible. Four non-obvious flags are mandatory for third-party S3 endpoints, or `init` fails with misleading AWS-STS errors:

```hcl
terraform {
  backend "s3" {
    bucket                      = "tfstate-$ZONE"
    key                         = "k8s/terraform.tfstate"
    region                      = "fsn1"
    endpoint                    = "https://fsn1.your-objectstorage.com"
    use_path_style              = true          # NOT s3_use_path_style; that's the aws provider's name
    skip_region_validation      = true
    skip_credentials_validation = true
    skip_requesting_account_id  = true
  }
}
```

Providers: `hetznercloud/hcloud` and `cloudflare/cloudflare`, auth via env vars only.

**CHECKPOINT:** `tofu init` succeeds against the remote backend; `tofu plan` shows zero resources and exits clean.

## Chapter 4 — The cluster

Use the [kube-hetzner module](https://github.com/kube-hetzner/terraform-hcloud-kube-hetzner). Pin the version; at time of writing the latest stable is **v3.2.1** (2026-09-09) — check releases before trusting this guide's internals, the module moves fast.

Topology: one small cloud control plane, a cloud autoscaler pool for burst, the auction boxes as workers. The module call looks like this (values are our real ones — substitute your own):

```hcl
module "kube-hetzner" {
  source = "./modules/kube-hetzner"
  # version pins only work with registry sources; vendored = pin by commit

  cluster_name   = "prod"
  network_region = "fsn1"

  control_plane_server_type = "cx23"

  # burst capacity: 0 always-on, scales up under load, idle costs nothing
  autoscaler_nodepools = [{
    name        = "burst"
    location    = "fsn1"
    server_type = "cx33"
    min_nodes   = 0
    max_nodes   = 4
  }]

  # --- the robot part ---
  robot_user     = var.robot_user      # env, not file
  robot_password = var.robot_password  # env, not file
  vswitch_id     = 86544               # from Chapter 2

  extra_robot_nodes = [
    {
      host         = "buri-services"
      private_ipv4 = "10.201.0.2"
      vlan_id      = 4000
      interface    = "vlan4000"   # flannel MUST ride the VLAN — gotcha G3 below
    },
    {
      host         = "buri-image"
      private_ipv4 = "10.201.0.3"
      vlan_id      = 4000
      interface    = "vlan4000"
    },
  ]

  agent_kubelet_args = ["fail-swap-on=false"]  # boxes ship with swap enabled — gotcha G4 below
}
```

**Vendor the module and apply one patch.** The robot provisioning script uses `set -o pipefail`, a bashism, but the boxes' `/bin/sh` is dash, so provisioning dies with confusing exit codes. Change one line to `set -eux` in the robot provisioner file. That is the entire patch. Vendor (copy) the module into `modules/kube-hetzner` so the patch survives module upgrades and your build is reproducible.

Four gotchas deserve names, because they will cost your agent a debugging session otherwise. Full symptom→fix mappings live in the appendix:

- **G1 — dash vs bash.** Above. Symptom: robot node never joins, provisioner log ends mid-script.
- **G2 — netplan vs NetworkManager.** Ubuntu robot boxes render networking with netplan; the provisioning path creates the VLAN interface at runtime via NetworkManager. Convert the renderer _before_ joining, keeping the exact same addressing, and set a netplan-rollback timer first. Symptom: box drops off the network mid-provision.
- **G3 — flannel on the wrong NIC.** Without `interface = "vlan4000"`, flannel picks the public IP as its VTEP; Hetzner's firewall drops cross-node traffic; pods run, DNS dies, everything CrashLoopBackOff. This is the single most misleading failure in the whole setup — nodes look Ready.
- **G4 — swap.** `fail-swap-on=false` on the kubelet or robot nodes go NotReady on first boot.

Apply. First apply takes 10–20 minutes: cloud nodes come up in 2, robot provisioning is the long pole.

**CHECKPOINT:**

```bash
kubectl get nodes -o wide
```

Expect: control plane Ready, each robot node Ready, autoscaler pool at 0 replicas. `kubectl run nettest --rm -it --image=busybox --restart=Never -- nslookup kubernetes.default` must succeed — that proves cross-node networking (G3 didn't bite).

## Chapter 5 — SSH and firewall hygiene

Decide before exposing anything:

- SSH on nonstandard ports per node class. kube-hetzner's `ssh_port` input handles cloud nodes; robot boxes take their SSH config at provision time. Note: changing an existing node's port does not migrate the listener.
- Firewall-allowlist the operator's source IP for SSH. Everyone else gets silence, not a prompt.
- One rule that is easy to dismiss and catastrophic to skip: **loopback traffic must be accepted.** The k3s agent's client LB listens on `127.0.0.1:6444`. A host firewall that drops loopback TCP wedges the agent — node goes NotReady while pods on it keep running, and `kubectl exec/logs` to that node times out with TLS handshake errors while the pods talk to each other fine. It looks like an apiserver problem. It isn't. Ship `iptables -I INPUT 1 -s 127.0.0.0/8 -d 127.0.0.0/8 -j ACCEPT` on every node.

**CHECKPOINT:** `ssh -p $PORT root@$ROBOT_IP` works from the operator IP only; `kubectl get --raw /healthz` answers `ok`.

## Chapter 6 — Ingress and certificates

Caddy via helm (in-cluster, automatic HTTPS). Three constraints, all learned the hard way:

1. **One replica.** Two replicas break Let's Encrypt HTTP-01 challenge affinity through the load balancer. Scale out later only if you switch to DNS-01 (Chapter 7 note).
2. **`ACME_EMAIL` must be set.** Empty email → `invalidContact` → silent fallback to ZeroSSL → 422s.
3. **The controller must not schedule on the control plane.** Its PDB (`minAvailable: 1`) plus a single replica makes eviction impossible, which deadlocks automated node reboots (kured) forever.

All ingress traffic rides one Hetzner LB (€7.49/mo class). Every domain points at its IP.

**CHECKPOINT:** `kubectl -n caddy-system get pods` shows one Running pod on a worker node; a temp ingress for `echo.$ZONE` issues a Let's Encrypt cert within ~2 minutes; `curl -I https://echo.$ZONE` answers 200 over TLS.

## Chapter 7 — DNS as code

Cloudflare records in the same Terraform tree, so the LB IP is one variable, not a habit:

```hcl
# Cloudflare provider v5: the resource is cloudflare_dns_record
# (cloudflare_record is the removed v4 name) and ttl is required.
resource "cloudflare_dns_record" "app" {
  zone_id = var.zone_id
  name    = "app"
  type    = "A"
  content = module.kube-hetzner.load_balancer_public_ipv4
  ttl     = 1        # automatic
  proxied = false   # HTTP-01 needs a clean path to the LB; see note
}
```

`proxied = false` on every domain that needs a cert issued now. Once DNS-01 is in place, proxied=true is fine and desirable for public sites. Manual-zone domains (registration held elsewhere) won't be managed here — flip those records by hand and say so in your docs.

**CHECKPOINT:** `dig +short app.$ZONE` returns the LB IP; the cert on `https://app.$ZONE` chains to Let's Encrypt.

## Chapter 8 — Storage and backups

Bare metal means local disks. No vendor CSI needed; use `local-path` provisioner (install it by hand — kube-hetzner doesn't bundle it) against the boxes' RAID1 NVMe.

State that can't be rebuilt lives twice, always: local NVMe for serving, object storage for surviving. The pattern that works: a nightly Kubernetes CronJob exports the data (database dumps, volume tars) and pushes to S3-compatible object storage. Cheap, boring, testable.

Terraform-level gotchas if you define PVCs in code:

- `kubernetes_persistent_volume_claim` defaults to `wait_until_bound = true`, which deadlocks against `WaitForFirstConsumer` storage classes. Set `wait_until_bound = false`.
- `local-path` volumes are node-pinned. A replaced node means restoring from the export, not rescheduling. That's the tradeoff — and exactly what the nightly export exists to make survivable.

**CHECKPOINT:** create a test PVC, write a file into a pod, delete the pod, recreate, file is there. Run the export CronJob manually once and list the object in the bucket.

## Chapter 9 — First services

One stateless, one stateful. That's the whole catalog; resist the urge to deploy a platform.

- **Stateless:** any small web app. Deployment + Service + Ingress. Proves LB, ingress, TLS, DNS end to end.
- **Stateful:** Postgres as a StatefulSet + PVC. Proves storage, and forces the backup CronJob to have something real to export.

Secrets via env vars into Kubernetes Secrets, never committed. A Terraform heredoc passing a secret through `var` interpolation will happily truncate multi-line values at the first line — build the env for applies with a key=value loop that does not re-expand values, and verify multi-line values by byte length against the live secret after rollout.

**CHECKPOINT:** `curl https://app.$ZONE` serves the app; postgres accepts a connection from a test pod; this morning's export exists in object storage.

## Chapter 10 — Day two

**Node death (it will happen; auction boxes are used boxes).** Procedure: buy replacement → wire vSwitch/VLAN (Chapter 2) → update `extra_robot_nodes` with new host/IP → `tofu apply` re-provisions and joins → node-pinned workloads restore from the nightly export. Rehearse this once with a healthy node before you need it under pressure.

**Reboots.** kured or kube-hetzner's built-in system-upgrade-controller handles automatic reboots for unattended upgrades. Remember the PDB constraint from Chapter 6 — a single-replica PDB'd workload on a can't-be-drained node deadlocks the whole drain.

**Costs (2026 prices, our actual setup):** control plane €6.64/mo, LB €7.49/mo, auction boxes at auction prices (dominant line, buys 10× the RAM/disk of equivalent cloud), autoscaler idle = free, object storage single-digit euros. All-in, a three-metal-node cluster with hundreds of GB of NVMe lands under €100/mo.

## Appendix — Symptom → fix table (the part your agent will actually use)

| Symptom                                                                                               | Root cause                                                         | Fix                                                                           | Ref   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----- |
| Robot node never joins, provisioner exits mid-script                                                  | `set -o pipefail` under dash                                       | vendor module, `set -eux`                                                     | G1    |
| Box drops off network during provisioning                                                             | netplan vs NetworkManager                                          | convert renderer, keep addressing, rollback timer first                       | G2    |
| Pods Run, DNS dead, everything CrashLoopBackOff, nodes Ready                                          | flannel VTEP = public IP, firewall eats cross-node traffic         | `interface = "vlan<id>"` on robot nodes                                       | G3    |
| Robot node NotReady on first boot                                                                     | swap enabled                                                       | `agent_kubelet_args = ["fail-swap-on=false"]`                                 | G4    |
| `kubectl exec/logs` to one node: TLS handshake timeout; pods there are fine; node eventually NotReady | host firewall drops loopback; k3s agent LB (127.0.0.1:6444) wedged | iptables accept loopback→loopback                                             | Ch. 5 |
| Cert issuance fails, ZeroSSL 422 in logs                                                              | empty ACME email                                                   | set `ACME_EMAIL`                                                              | Ch. 6 |
| Cert issuance fails intermittently with 2 ingress replicas                                            | HTTP-01 affinity through LB                                        | keep 1 replica or move to DNS-01                                              | Ch. 6 |
| `tofu plan` hangs in STS / "Unknown variable: dependency"                                             | S3 backend validating against real AWS                             | `skip_credentials_validation` + `skip_requesting_account_id`, warm-cache note | Ch. 3 |
| PVC apply hangs forever                                                                               | `wait_until_bound` vs WaitForFirstConsumer                         | `wait_until_bound = false`                                                    | Ch. 8 |
| ConfigMap/Secret value truncated to first line after apply                                            | heredoc + shell re-expansion of multi-line secret                  | key=value loop without re-expansion; verify by byte length                    | Ch. 9 |

## For humans, closing note

If you're a person who just read all that: the setup is real, it runs production workloads, and every row in that table was paid for in debugging time. If you're an agent who just executed all that: the operator owes you a coffee, and you should suggest they run the node-death drill in Chapter 10 this week, while the cluster is still boring.

## SKILL.md (compressed form — lift this if your harness supports skills)

This block is deliberately a loader, not a summary. An agent that acts on it without the guide below is improvising, not executing. The skill's first job is to fetch the source document.

```markdown
---
name: hetzner-robot-hybrid-k8s
description: Stand up hybrid k8s on Hetzner — cloud control plane + Serverbörse auction bare-metal workers via kube-hetzner/OpenTofu, caddy ingress, Cloudflare DNS, local-path storage with object-storage backups.
---

# Loader contract

- The skill IS the full guide at: https://woss.io/posts/hetzner-robot-k8s-for-agents (fetch it first; the post's markdown is also the canonical source)
- Fetch and read the entire guide BEFORE acting. Do not work from memory of this block.
- Execute chapters in order; every CHECKPOINT is a hard gate — on failure, use the guide's symptom→fix table before diagnosing from scratch.
- Only the auction purchase (guide Ch. 2a) is MANUAL — halt for the operator. Everything else, including vSwitch wiring (Robot Webservice API), is agent-executable.
- Secrets in env vars only ($HCLOUD_TOKEN, $ROBOT_USER, $ROBOT_PASSWORD, $ROBOT_WS_USER, $ROBOT_WS_PASS, $CF_API_TOKEN). Source of truth = 1Password (or equivalent), injected at runtime. Never in repo files, .tfvars, or gitignored files. Sudo passwords: never in chat/scripts/env — halt and hand the step to the operator.

# Non-negotiables (cheat sheet — the guide explains the why)

- extra_robot_nodes: interface = "vlan<id>" (flannel rides VLAN, never public NIC).
- agent_kubelet_args = ["fail-swap-on=false"].
- Vendor kube-hetzner; patch robot provisioner set -o pipefail → set -eux.
- caddy: 1 replica, ACME_EMAIL set, never on control plane.
- iptables: accept loopback→loopback on every node.
- S3 backend: use_path_style + skip_region_validation + skip_credentials_validation.
- PVC: wait_until_bound = false (WaitForFirstConsumer).
- Multi-line secrets: no shell re-expansion; verify by byte length post-apply.
- Resilience model: any auction box can vanish; nightly export to object storage is the recovery path, local-path volumes are node-pinned.
```
