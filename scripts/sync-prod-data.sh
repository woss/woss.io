#!/bin/bash
set -eo pipefail

# Sync production data from the k8s cluster to local ./prod/
# Data lives on PVC woss-data mounted at /app/data in the woss pod (woss-prod).
# Streams a gzipped tar over kubectl exec, excluding the HuggingFace cache
# (.hf-cache) which is large and unnecessary locally.
#
# Config (defaults below; .env values win):
#   K8S_CONTEXT     kubectl context (default: kelp, the prod cluster)
#   K8S_NAMESPACE   namespace (default: woss-prod)
#   K8S_DEPLOYMENT  deployment + app label (default: woss)
#   K8S_CONTAINER   container name (default: woss)
#   K8S_PATH        data dir inside the container (default: /app/data)

# Flags:
#   --to-dev   Sync prod data from the cluster, then copy DB + index + centroids to ./data/
#   --help,-h  Show this help

# Load .env from project root
if [ -f "$(dirname "$0")/../.env" ]; then
  source "$(dirname "$0")/../.env"
fi

case "${1:-}" in
  --help|-h)
    echo "Usage: $(basename "$0") [--to-dev]"
    echo "  (no flag)  Sync production data from the cluster to ./prod/"
    echo "  --to-dev   Sync prod data from the cluster, then copy to ./data/"
    echo "  --help     Show this help"
    exit 0
    ;;
  --to-dev)
    TO_DEV=true
    ;;
  "")
    # default: sync to ./prod/
    ;;
  *)
    echo "Error: Unknown option $1"
    echo "Usage: $(basename "$0") [--to-dev]"
    exit 1
    ;;
esac

K8S_NAMESPACE="${K8S_NAMESPACE:-woss-prod}"
K8S_DEPLOYMENT="${K8S_DEPLOYMENT:-woss}"
K8S_CONTAINER="${K8S_CONTAINER:-woss}"
K8S_PATH="${K8S_PATH:-/app/data}"
LOCAL_DIR="./prod"
EXCLUDE_PATTERN=".hf-cache"

KUBECTL=(kubectl --context "${K8S_CONTEXT:-kelp}")

command -v kubectl >/dev/null || { echo "Error: kubectl not found in PATH"; exit 1; }

# Resolve the running pod for the deployment (single replica)
POD="$("${KUBECTL[@]}" get pods -n "$K8S_NAMESPACE" \
  -l "app=${K8S_DEPLOYMENT}" \
  --field-selector=status.phase=Running \
  -o jsonpath='{.items[0].metadata.name}')"
if [ -z "$POD" ]; then
  echo "Error: no running pod for app=${K8S_DEPLOYMENT} in namespace ${K8S_NAMESPACE}"
  exit 1
fi

mkdir -p "$LOCAL_DIR"

echo "[$(date)] Starting sync from ${K8S_NAMESPACE}/${POD}:${K8S_PATH} → ${LOCAL_DIR}/"
echo "[$(date)] Excluding: ${EXCLUDE_PATTERN}"

# Mirror semantics (like rsync --delete): clear local dir, then extract the
# streamed archive. --exclude prunes the .hf-cache dir before it's sent.
find "$LOCAL_DIR" -mindepth 1 -delete

"${KUBECTL[@]}" exec -n "$K8S_NAMESPACE" -c "$K8S_CONTAINER" "$POD" -- \
  tar -C "$K8S_PATH" -cz --exclude="./${EXCLUDE_PATTERN}" . \
  | tar -C "$LOCAL_DIR" -xzv

echo "[$(date)] Sync complete"

if [ "${TO_DEV:-false}" = "true" ]; then
  echo "[$(date)] Copying prod data to ./data/..."
  mkdir -p ./data/
  cp -v ./prod/woss.db ./data/woss.db
  [ -f ./prod/woss.usearch ] && cp -v ./prod/woss.usearch ./data/ || true
  [ -f ./prod/centroid.json ] && cp -v ./prod/centroid.json ./data/ || true
  echo "[$(date)] Done"
fi
