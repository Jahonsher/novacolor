#!/bin/sh
# NovaColor container entrypoint.
# The container starts as root only to make DATA_DIR writable for the unprivileged "node" user
# (a bind-mounted ./data created by Docker or restored from a backup is often owned by root),
# then drops privileges and runs the server as "node".
set -e

DATA_DIR="${DATA_DIR:-/app/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # Only touch files that are not already owned by node (cheap on every restart).
  find "$DATA_DIR" ! -user node -exec chown node:node {} + 2>/dev/null || true
  exec su-exec node "$@"
fi

exec "$@"
