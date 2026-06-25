#!/bin/bash
set -e

# Sync production data from remote server to local ./prod/
# Excludes HuggingFace cache (.hf-cache) which can be large and unnecessary locally.
# REMOTE_HOST and REMOTE_PATH are loaded from .env — fail if missing.

# Load .env from project root
if [ -f "$(dirname "$0")/../.env" ]; then
  source "$(dirname "$0")/../.env"
fi

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
