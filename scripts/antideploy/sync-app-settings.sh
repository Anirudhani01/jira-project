#!/usr/bin/env sh
# Point the linked Antideploy GitHub app at the repository root (monolith Dockerfile).
set -eu
ROOT="$(CDPATH= cd "$(dirname "$0")/../.." && pwd)"
APP_ID="$(sed -n 's/.*"applicationId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/.antideploy.json")"
CONFIG="${HOME}/.antideploy/config.json"
test -n "$APP_ID"
test -s "$CONFIG"
TOKEN="$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$CONFIG")"
test -n "$TOKEN"
curl -fsS -X PATCH "https://antideploy.com/api/v1/applications/$APP_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d '{"rootDirectory":null}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print('rootDirectory:', d.get('rootDirectory')); print('framework:', (d.get('analysis') or {}).get('framework'))"
