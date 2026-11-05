#!/bin/sh
set -eu
# Usar las credenciales existentes con encoding correcto, sin imprimir la URL.
export DATABASE_URL="$(node -e 'const u=new URL("postgresql://postgres:5432/");u.username=process.env.POSTGRES_USER;u.password=process.env.POSTGRES_PASSWORD;u.pathname="/"+process.env.POSTGRES_DB;process.stdout.write(u.href)')"
exec /usr/local/bin/trimia-start "$@"
