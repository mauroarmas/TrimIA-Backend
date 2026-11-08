#!/bin/sh
set -eu
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export N8N_HOST="${RENDER_EXTERNAL_HOSTNAME}"
  export N8N_PROTOCOL=https
  export WEBHOOK_URL="${RENDER_EXTERNAL_URL}/"
  export N8N_EDITOR_BASE_URL="${RENDER_EXTERNAL_URL}"
fi
if [ -n "${TRIMIA_API_HOSTPORT:-}" ]; then
  export TRIMIA_API_URL="http://${TRIMIA_API_HOSTPORT}"
fi
if [ "$#" -gt 0 ]; then
  exec n8n "$@"
fi
exec n8n start
