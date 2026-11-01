#!/bin/sh
set -eu

if [ -z "${PORT:-}" ]; then
  PORT=8080
fi
export PORT

if [ -z "${APP_BASE_URL:-}" ] && [ -n "${APP_URL:-}" ]; then
  export APP_BASE_URL="$APP_URL"
fi

if [ -n "${MIGRATION_DATABASE_URL:-}" ]; then
  echo "Running database migrations..."
  alembic upgrade head
fi

mkdir -p /tmp/nginx/conf.d
envsubst '${PORT}' < /etc/nginx/templates/default.conf.template > /tmp/nginx/conf.d/default.conf

uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log --proxy-headers &
api_pid=$!

cleanup() {
  kill "$api_pid" 2>/dev/null || true
}
trap cleanup INT TERM

exec nginx -c /app/scripts/antideploy/nginx.main.conf -g 'daemon off;'
