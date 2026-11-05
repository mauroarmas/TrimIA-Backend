#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
command_name="${1:-help}"
if [ "$command_name" = init ]; then
  exec node scripts/prepare-local-demo.cjs
fi
if [ ! -f .env ] || [ ! -f deploy/local/.env ]; then
  echo 'Se necesitan .env y deploy/local/.env. Ejecutá: bash scripts/demo-local.sh init' >&2
  exit 1
fi
compose=(docker compose --env-file .env --env-file deploy/local/.env -f docker-compose.yml -f deploy/local/compose.yml)
backup() {
  umask 077
  mkdir -p storage/backups
  backup_path="storage/backups/demo-$(date +%Y%m%d-%H%M%S).sql"
  "${compose[@]}" exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_path"
  echo "Respaldo guardado en $backup_path"
}
case "$command_name" in
  up)
    node -e 'process.loadEnvFile("deploy/local/.env");const e=process.env;if(!e.DEMO_PUBLIC_URL?.startsWith("https://")||e.DEMO_PUBLIC_URL.includes("TU-RED")||!e.META_APP_SECRET||!e.META_VERIFY_TOKEN||e.META_VERIFY_TOKEN.length<32)throw Error("Completá la URL real y los datos de Meta en deploy/local/.env")'
    (cd ../trimIA-frontend && VITE_API_BASE_URL= VITE_API_BASE= VITE_SAME_ORIGIN=true npm run build)
    "${compose[@]}" build nestjs gateway
    "${compose[@]}" up -d --wait postgres redis chromadb
    backup
    "${compose[@]}" run --rm --no-deps nestjs npm run db:deploy
    "${compose[@]}" up -d n8n nestjs gateway
    echo 'Demo: http://localhost:8080. Editor privado de n8n: http://localhost:5678.'
    ;;
  backup) backup ;;
  down) "${compose[@]}" down ;;
  logs) "${compose[@]}" logs --tail=80 -f nestjs gateway n8n ;;
  status) "${compose[@]}" ps ;;
  *) echo 'Uso: bash scripts/demo-local.sh init|up|backup|status|logs|down' ;;
esac
