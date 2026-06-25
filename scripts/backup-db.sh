#!/bin/bash
set -e

BACKUP_DIR="./data/db-backup"
mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y%m%d-%H%M%S")

# Checkpoint WAL for consistent snapshot
sqlite3 data/woss.db "PRAGMA wal_checkpoint(TRUNCATE)" 2>/dev/null || true

# Copy and compress
cp data/woss.db "$BACKUP_DIR/woss-$TIMESTAMP.db"
gzip -f "$BACKUP_DIR/woss-$TIMESTAMP.db"

# Keep last 144 backups (24 hours at 10-min intervals)
ls -t "$BACKUP_DIR"/woss-*.db.gz 2>/dev/null | tail -n +145 | xargs -r rm

echo "[$(date)] Backed up to woss-$TIMESTAMP.db.gz"
