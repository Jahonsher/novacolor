#!/bin/sh
# NovaColor: archive the data/ folder (content, leads, chats, uploads, settings).
#   ./deploy/backup.sh                 -> ~/novacolor-backups/novacolor-data-YYYYmmdd-HHMM.tar.gz
#   BACKUP_DIR=/path KEEP=30 ./deploy/backup.sh
# Keeps the newest $KEEP archives (default 14). Safe to run while the site is running
# (the server writes files atomically). Archives contain secrets (settings.json) — keep them private.
set -eu

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$HOME/novacolor-backups}"
KEEP="${KEEP:-14}"

[ -d "$APP_DIR/data" ] || { echo "data/ topilmadi: $APP_DIR/data" >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

FILE="$BACKUP_DIR/novacolor-data-$(date +%Y%m%d-%H%M).tar.gz"
tar -czf "$FILE" -C "$APP_DIR" data
chmod 600 "$FILE"
echo "Zaxira tayyor: $FILE ($(du -h "$FILE" | cut -f1))"

# delete old archives, keep the newest $KEEP
ls -1t "$BACKUP_DIR"/novacolor-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old"
done
