#!/usr/bin/env bash
# Provisions database roles and databases. DEV/CI ONLY — production roles are
# provisioned by infrastructure-as-code with secrets from a secret manager.
#
# Runs automatically via the postgres image's /docker-entrypoint-initdb.d on first
# start, and can be re-run safely (idempotent): it (re)asserts role attributes.
#
# Required env: APP_OWNER_PASSWORD, APP_RW_PASSWORD, APP_WORKER_PASSWORD
# Optional env: APP_DB_NAMES (comma- or space-separated, default "jira,jira_test"),
#               POSTGRES_USER, POSTGRES_DB
set -euo pipefail

: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD is required}"
: "${APP_RW_PASSWORD:?APP_RW_PASSWORD is required}"
: "${APP_WORKER_PASSWORD:?APP_WORKER_PASSWORD is required}"
APP_DB_NAMES="${APP_DB_NAMES:-jira,jira_test}"
IFS=", " read -r -a DB_NAMES <<< "$APP_DB_NAMES"

psql_admin() {
  psql -v ON_ERROR_STOP=1 --no-psqlrc --username "${POSTGRES_USER:-postgres}" "$@"
}

# Roles: none are superusers, none bypass RLS, none can create roles/databases.
# app_owner owns the schema objects and runs migrations; app_rw and app_worker are
# runtime roles that only receive privileges granted by migrations.
psql_admin --dbname "${POSTGRES_DB:-postgres}" \
  -v owner_pw="$APP_OWNER_PASSWORD" \
  -v rw_pw="$APP_RW_PASSWORD" \
  -v worker_pw="$APP_WORKER_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE app_owner' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_owner') \gexec
SELECT 'CREATE ROLE app_rw' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') \gexec
SELECT 'CREATE ROLE app_worker' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_worker') \gexec
-- Read-only access to security.platform_security_events (plan V2.7). NOLOGIN: humans
-- get it via a separate audited login role granted membership; never the app.
SELECT 'CREATE ROLE platform_security_reader' WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'platform_security_reader') \gexec

ALTER ROLE app_owner  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD :'owner_pw';
ALTER ROLE app_rw     LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT PASSWORD :'rw_pw';
ALTER ROLE app_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT PASSWORD :'worker_pw';
ALTER ROLE platform_security_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION;
SQL

for db in "${DB_NAMES[@]}"; do
  [[ "$db" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] || { echo "invalid database name: $db" >&2; exit 1; }
  psql_admin --dbname "${POSTGRES_DB:-postgres}" -v db="$db" <<'SQL'
SELECT format('CREATE DATABASE %I OWNER app_owner', :'db')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db') \gexec
SQL
  psql_admin --dbname "$db" -v db="$db" <<'SQL'
REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO app_owner;
GRANT CONNECT ON DATABASE :"db" TO app_rw, app_worker;
-- Nobody but the schema owner may create objects in public.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
done

echo "Provisioned roles app_owner, app_rw, app_worker, platform_security_reader and databases: ${DB_NAMES[*]}"
