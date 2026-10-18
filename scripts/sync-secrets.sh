#!/usr/bin/env bash
# Sync WOSS_* secrets from .env to BOTH stores they live in:
#   1. GitHub Actions secrets (deploy.yml rewrites k8s woss-secrets from these on every deploy)
#   2. k8s secret woss-secrets in woss-prod (used by the running pods right now)
# Skipping either store causes drift: deploys revert live keys, or pods run stale keys.
#
# Usage:
#   scripts/sync-secrets.sh            # sync keys found in .env to both stores
#   scripts/sync-secrets.sh --check    # verify both stores match .env, write nothing
#
# Keys absent from .env (e.g. MCL_MCP_API_KEY) are reported but left untouched in
# both stores — sync is additive/patch-based, it never drops a live key.
#
# Env overrides: ENV_FILE (default .env), WOSS_K8S_NAMESPACE (default woss-prod).
# Requires: gh (authed, repo woss/woss.io), kubectl (context: kelp cluster), curl, shasum, python3.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env}"
NAMESPACE="${WOSS_K8S_NAMESPACE:-woss-prod}"
CHECK=0
[ "${1:-}" = "--check" ] && CHECK=1

# .env name -> secret key name (identical in GH Actions and k8s)
# NOTE: MCP_SERVERS is deliberately NOT synced — prod uses in-cluster service URLs
# (unified-link.macula-prod.svc...) and is managed directly in GH Actions/k8s.
MAPPING=(
  "PROVIDER_API_KEY:WOSS_PROVIDER_API_KEY"
  "GITHUB_TOKEN:WOSS_GITHUB_TOKEN"
  "MCL_MCP_API_KEY:WOSS_MCL_MCP_API_KEY"
  "WOSS_USER_WEBHOOK_URL:WOSS_USER_WEBHOOK_URL"
  "WOSS_USER_WEBHOOK_ERROR_URL:WOSS_USER_WEBHOOK_ERROR_URL"
  "WOSS_USER_WEBHOOK_TOKEN:WOSS_USER_WEBHOOK_TOKEN"
)

hash_of() { printf '%s' "$1" | shasum -a 256 | cut -c1-16; }

env_val() { # .env value by key; empty output if missing
  awk -F= -v k="$1" '$1 == k { print substr($0, index($0, "=") + 1); exit }' "$ENV_FILE"
}

k8s_val() { # current k8s secret value (raw) for key
  kubectl -n "$NAMESPACE" get secret woss-secrets \
    -o "jsonpath={.data.$1}" 2>/dev/null | base64 -d 2>/dev/null || true
}

patch_json() { # JSON patch body for one key, safe for any value
  python3 -c 'import json, os, sys; print(json.dumps({"stringData": {os.environ["K"]: os.environ["V"]}}))'
}

fail=0
changed_any=0

# 1. Live-verify the provider key before propagating it anywhere.
if pk="$(env_val PROVIDER_API_KEY)" && [ -n "$pk" ]; then
  status="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${pk}" \
    "${LLM_PROVIDER_BASE_URL:-https://opencode.ai/zen/v1}/models")"
  if [ "$status" != "200" ]; then
    echo "error: .env PROVIDER_API_KEY rejected by provider (HTTP ${status}) — fix .env first, syncing nothing." >&2
    exit 1
  fi
  echo "✓ .env PROVIDER_API_KEY accepted by provider"
fi

for pair in "${MAPPING[@]}"; do
  src="${pair%%:*}"; dst="${pair##*:}"
  val="$(env_val "$src")"

  if [ -z "$val" ]; then
    if [ -n "$(k8s_val "$dst")" ]; then
      echo "• ${dst}: not in $ENV_FILE — left untouched in stores (add to $ENV_FILE to manage here)"
    else
      echo "✗ ${dst}: missing from $ENV_FILE AND k8s woss-secrets"
      fail=1
    fi
    continue
  fi
  h="$(hash_of "$val")"

  # --- GH Actions secret (values unreadable once set; set or verify existence) ---
  if [ "$CHECK" = 0 ]; then
    gh secret set "$dst" -R woss/woss.io --body "$val" >/dev/null
    echo "✓ ${dst}: GH Actions set (${h})"
    changed_any=1
  elif gh secret list -R woss/woss.io | awk '{print $1}' | grep -qx "$dst"; then
    echo "✓ ${dst}: present in GH Actions (value not readable; hash ${h} is the .env source)"
  else
    echo "✗ ${dst}: missing in GH Actions secrets"
    fail=1
  fi

  # --- k8s secret (values readable: compare, then per-key patch — never drop) ---
  if [ "$(hash_of "$(k8s_val "$dst")")" = "$h" ]; then
    echo "✓ ${dst}: k8s matches .env (${h})"
  elif [ "$CHECK" = 0 ]; then
    K="$dst" V="$val" kubectl -n "$NAMESPACE" patch secret woss-secrets --type merge -p "$(patch_json)" >/dev/null
    echo "✓ ${dst}: k8s patched (${h})"
    changed_any=1
  else
    echo "✗ ${dst}: k8s woss-secrets differs from .env"
    fail=1
  fi
done

if [ "$CHECK" = 1 ]; then
  [ "$fail" = 0 ] && echo "all keys in sync" || { echo "drift detected — run scripts/sync-secrets.sh (no --check)" >&2; exit 1; }
  exit 0
fi

if [ "$changed_any" = 1 ]; then
  echo "✓ synced. Pods read env at start — 'kubectl -n $NAMESPACE rollout restart deployment/woss' to pick up rotated keys."
fi
