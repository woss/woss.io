#!/bin/bash
set -e

# Sync production data from remote server to local ./prod/
# Excludes HuggingFace cache (.hf-cache) which can be large and unnecessary locally.
# REMOTE_HOST and REMOTE_PATH are loaded from .env — fail if missing.

# Flags:
#   --to-dev   Sync prod data from remote, then copy DB + index + centroids to ./data/
#   --help,-h  Show usage

# Load .env from project root
if [ -f "$(dirname "$0")/../.env" ]; then
  source "$(dirname "$0")/../.env"
fi

case "${1:-}" in
  --help|-h)
    echo "Usage: $(basename "$0") [--to-dev]"
    echo "  (no flag)  Sync production data from remote server to ./prod/"
    echo "  --to-dev   Sync prod data from remote, then copy to ./data/"
    echo "  --help     Show this help"
    exit 0
    ;;
  --to-dev)
    TO_DEV=true
    ;;
  "")
    # default: original rsync behavior
    ;;
  *)
    echo "Error: Unknown option $1"
    echo "Usage: $(basename "$0") [--to-dev]"
    exit 1
    ;;
esac

# Fail hard if production sync target isn't configured
: "${REMOTE_HOST:?REMOTE_HOST not set — add to .env}"
: "${REMOTE_PATH:?REMOTE_PATH not set — add to .env}"
LOCAL_DIR="./prod"
EXCLUDE_PATTERN=".hf-cache"

mkdir -p "$LOCAL_DIR"

echo "[$(date)] Starting sync from ${REMOTE_HOST}:${REMOTE_PATH} → ${LOCAL_DIR}/"
echo "[$(date)] Excluding: ${EXCLUDE_PATTERN}"

rsync -avz --delete --progress \
  --exclude="$EXCLUDE_PATTERN" \
  "${REMOTE_HOST}:${REMOTE_PATH}" \
  "${LOCAL_DIR}/"

echo "[$(date)] Sync complete"

if [ "$TO_DEV" = "true" ]; then
  echo "[$(date)] Copying prod data to ./data/..."
  mkdir -p ./data/
  cp -v ./prod/woss.db ./data/woss.db
  [ -f ./prod/woss.usearch ] && cp -v ./prod/woss.usearch ./data/ || true
  [ -f ./prod/centroid.json ] && cp -v ./prod/centroid.json ./data/ || true
  echo "[$(date)] Done"
fi
