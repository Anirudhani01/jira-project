"""R3.5 test_rls_catalog: every tenant table has FORCED RLS and policies, and every FK
between org-owned tables includes org_id. Gates every later migration: a new tenant table
fails CI until it complies. Catalog inspection only (no data access)."""

from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from tests.integration.tenancy_support import TENANT_TABLES

TABLES_WITH_ORG_ID = text(
    """
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND (EXISTS (SELECT 1 FROM pg_attribute a
                     WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
            OR c.relname = 'organizations')
    """
)
# FKs whose referencing AND referenced tables both have an org_id column.
FKS_BETWEEN_ORG_TABLES = text(
    """
    SELECT con.conname, src.relname AS source, dst.relname AS target,
           EXISTS (SELECT 1 FROM unnest(con.conkey) k
                     JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k
                    WHERE a.attname = 'org_id') AS includes_org_id
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class dst ON dst.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace
     WHERE con.contype = 'f' AND n.nspname = 'public'
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = src.oid AND a.attname = 'org_id')
       AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = dst.oid AND a.attname = 'org_id')
    """
)


async def _violations(conn: AsyncConnection) -> list[str]:
    problems: list[str] = []
    for row in (await conn.execute(TABLES_WITH_ORG_ID)).all():
        if not (row.relrowsecurity and row.relforcerowsecurity and row.policies >= 1):
            problems.append(f"{row.relname}: RLS not forced or no policy")
    for row in (await conn.execute(FKS_BETWEEN_ORG_TABLES)).all():
        if not row.includes_org_id:
            problems.append(f"{row.conname}: {row.source} -> {row.target} lacks org_id")
    return problems


async def test_every_tenant_table_has_forced_rls_and_org_scoped_fks(
    owner_engine: AsyncEngine,
) -> None:
    async with owner_engine.connect() as conn:
        assert await _violations(conn) == []
        names = {r.relname for r in (await conn.execute(TABLES_WITH_ORG_ID)).all()}
    assert {"organizations", *TENANT_TABLES} <= names


async def test_catalog_check_detects_a_non_compliant_table(owner_engine: AsyncEngine) -> None:
    """The check is not vacuous: a table without RLS and a cross-org FK without org_id
    are both reported (created in a rolled-back transaction)."""
    async with owner_engine.connect() as conn:
        transaction = await conn.begin()
        try:
            await conn.execute(
                text(
                    "CREATE TABLE m3_catalog_probe (id uuid PRIMARY KEY, org_id uuid NOT NULL, "
                    "type_id uuid REFERENCES issue_types (id))"
                )
            )
            found = await _violations(conn)
        finally:
            await transaction.rollback()
    assert any("m3_catalog_probe: RLS" in p for p in found)
    assert any("m3_catalog_probe -> issue_types lacks org_id" in p for p in found)


async def test_child_tables_offer_composite_fk_targets(owner_engine: AsyncEngine) -> None:
    """Tenant tables referenced by later milestones expose UNIQUE (org_id, id)."""
    query = text(
        "SELECT conrelid::regclass::text AS tbl FROM pg_constraint "
        "WHERE contype = 'u' AND conname = conrelid::regclass::text || '_org_id_id' "
        "OR conname = 'uq_' || conrelid::regclass::text || '_org_id_id'"
    )
    async with owner_engine.connect() as conn:
        tables: set[Any] = {r.tbl for r in (await conn.execute(query)).all()}
    assert {"issue_types", "priorities"} <= tables
