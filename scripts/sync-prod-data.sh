#!/bin/bash
set -e

# Sync production data from buri-image remote server to local ./prod/
# Excludes HuggingFace cache (.hf-cache) which can be large and unnecessary locally.

REMOTE_HOST="buri-image"
REMOTE_PATH="/home/woss/projects/woss.io/data/"
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
