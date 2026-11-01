#!/usr/bin/env python3
"""One-time: provision app_* roles on Antideploy/Neon Postgres and write app secrets to a file.

Reads the owner connection from .env (DATABASE_URL from GET /api/v1/database/env).
Writes role passwords and derived URLs to .antideploy-secrets.env (git-ignored). Never
prints secrets to stdout.
"""

from __future__ import annotations

import asyncio
import secrets
import sys
from pathlib import Path
from urllib.parse import quote_plus, urlsplit, urlunsplit

import asyncpg

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".env"
OUT_FILE = ROOT / ".antideploy-secrets.env"

ROLE_ATTRS = {
    "app_owner": "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION",
    "app_rw": "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT",
    "app_worker": "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT",
    "app_retention": "LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION NOINHERIT",
    "platform_security_reader": "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION",
    "org_auth_operator": "NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION",
}


def _load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def _to_asyncpg_dsn(url: str) -> str:
    return url.replace("postgresql+asyncpg://", "postgresql://", 1)


def _normalize_query(query: str) -> str:
    if not query:
        return query
    pairs = []
    for part in query.split("&"):
        if part.startswith("sslmode="):
            pairs.append("ssl=" + part.split("=", 1)[1])
        elif part.startswith("channel_binding="):
            continue
        else:
            pairs.append(part)
    return "&".join(pairs)


def _role_url(owner_url: str, role: str, password: str) -> str:
    parts = urlsplit(_to_asyncpg_dsn(owner_url))
    netloc = parts.hostname or ""
    if parts.port:
        netloc = f"{netloc}:{parts.port}"
    netloc = f"{quote_plus(role)}:{quote_plus(password)}@{netloc}"
    query = _normalize_query(parts.query)
    return urlunsplit(("postgresql+asyncpg", netloc, parts.path, query, parts.fragment))


async def _ensure_role(
    conn: asyncpg.Connection, role: str, password: str | None, attrs: str
) -> None:
    exists = await conn.fetchval("SELECT 1 FROM pg_roles WHERE rolname = $1", role)
    if not exists:
        await conn.execute(f"CREATE ROLE {role} {attrs}")
    if password is not None:
        safe_pw = password.replace("'", "''")
        await conn.execute(f"ALTER ROLE {role} PASSWORD '{safe_pw}'")


async def _bootstrap(conn: asyncpg.Connection, passwords: dict[str, str]) -> None:
    for role, attrs in ROLE_ATTRS.items():
        pw = passwords.get(role)
        await _ensure_role(conn, role, pw, attrs)

    db_name = await conn.fetchval("SELECT current_database()")
    await conn.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
    await conn.execute(
        f'GRANT CONNECT ON DATABASE "{db_name}" TO app_rw, app_worker, app_retention'
    )
    await conn.execute(f'GRANT CREATE ON DATABASE "{db_name}" TO app_owner')
    await conn.execute("GRANT CREATE ON SCHEMA public TO app_owner")
    await conn.execute("GRANT app_owner TO CURRENT_USER")
    await conn.execute("SET ROLE app_owner")
    await conn.execute("RESET ROLE")
    try:
        await conn.execute("ALTER SCHEMA public OWNER TO app_owner")
    except asyncpg.InsufficientPrivilegeError:
        # Neon: owner transfer is optional if app_owner can CREATE in public.
        pass


async def main() -> int:
    env = _load_env(ENV_FILE)
    owner_url = env.get("DATABASE_URL")
    if not owner_url:
        print(
            "Missing DATABASE_URL in .env — create the Antideploy database and append its env first.",
            file=sys.stderr,
        )
        return 1
    if "localhost" in owner_url or "127.0.0.1" in owner_url:
        print("DATABASE_URL still points at localhost; use the Antideploy database env.", file=sys.stderr)
        return 1

    passwords = {
        role: secrets.token_urlsafe(32)
        for role in ROLE_ATTRS
        if "NOLOGIN" not in ROLE_ATTRS[role]
    }

    conn = await asyncpg.connect(_to_asyncpg_dsn(owner_url))
    try:
        await _bootstrap(conn, passwords)
    finally:
        await conn.close()

    urls = {key: _role_url(owner_url, role, passwords[role]) for key, role in (
        ("DATABASE_URL", "app_rw"),
        ("MIGRATION_DATABASE_URL", "app_owner"),
        ("WORKER_DATABASE_URL", "app_worker"),
        ("RETENTION_DATABASE_URL", "app_retention"),
    )}
    static = {
        "ENVIRONMENT": "prod",
        "LOG_LEVEL": "INFO",
        "COOKIE_SECURE": "true",
        "BREACH_CHECK_MODE": "hibp",
        "RATE_LIMIT_ENABLED": "true",
        "UVICORN_FORWARDED_ALLOW_IPS": "*",
        "SIGNUP_ENABLED": "false",
        "EMAIL_DELIVERY_ENABLED": "false",
        "APP_SECRET_KEY": secrets.token_urlsafe(48),
    }
    lines = [*(f"{k}={v}" for k, v in {**static, **urls}.items())]
    OUT_FILE.write_text("\n".join(lines) + "\n")
    OUT_FILE.chmod(0o600)
    print(
        f"Wrote {OUT_FILE.name} (role URLs and prod flags). Add REDIS_URL, then push secrets to Antideploy."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
