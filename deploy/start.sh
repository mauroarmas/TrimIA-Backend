#!/bin/sh
set -eu
# Render permite referencias host:puerto, pero no interpolación de URLs en YAML.
if [ -n "${CHROMA_HOSTPORT:-}" ]; then
  export CHROMA_URL="http://${CHROMA_HOSTPORT}"
fi
if [ -n "${N8N_HOSTPORT:-}" ]; then
  export N8N_BASE_URL="http://${N8N_HOSTPORT}"
fi
if [ "$(id -u)" = "0" ]; then
  chown node:node /app/storage
  exec gosu node "$@"
fi
exec "$@"
