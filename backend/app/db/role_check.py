"""Runtime database-role safety checks.

The API and worker must connect as least-privileged roles: not a superuser, not
BYPASSRLS, not able to create roles/databases, not owning tables/schemas/the database,
not a member of ``app_owner``, and unable to create objects in ``public``. Row-level
security does not apply to superusers, BYPASSRLS roles or (without FORCE) table owners,
so a misconfigured role would silently disable tenant isolation.
"""

import logging
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

logger = logging.getLogger("app.db.role_check")

_INSPECT_SQL = text(
    r"""
    SELECT
        r.rolname AS role_name,
        r.rolsuper AS is_superuser,
        r.rolbypassrls AS bypass_rls,
        r.rolcreaterole AS create_role,
        r.rolcreatedb AS create_db,
        (SELECT count(*) FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relowner = r.oid
              AND n.nspname NOT IN ('pg_catalog', 'information_schema')
              AND n.nspname NOT LIKE 'pg\_toast%') AS owned_relations,
        (SELECT count(*) FROM pg_namespace n
            WHERE n.nspowner = r.oid
              AND n.nspname NOT LIKE 'pg\_%'
              AND n.nspname <> 'information_schema') AS owned_schemas,
        (SELECT d.datdba = r.oid FROM pg_database d
            WHERE d.datname = current_database()) AS owns_database,
        has_schema_privilege(r.oid, 'public', 'CREATE') AS can_create_in_public,
        COALESCE((SELECT pg_has_role(r.oid, o.oid, 'MEMBER') FROM pg_roles o
            WHERE o.rolname = 'app_owner' AND o.oid <> r.oid), false) AS member_of_owner
    FROM pg_roles r
    WHERE r.rolname = current_user
    """
)


class UnsafeDatabaseRoleError(RuntimeError):
    def __init__(self, role: str, violations: list[str]) -> None:
        super().__init__(f"database role {role!r} is unsafe for runtime use: {violations}")
        self.role = role
        self.violations = violations


@dataclass(frozen=True, slots=True)
class RoleReport:
    role_name: str
    is_superuser: bool
    bypass_rls: bool
    create_role: bool
    create_db: bool
    owned_relations: int
    owned_schemas: int
    owns_database: bool
    can_create_in_public: bool
    member_of_owner: bool

    def violations(self) -> list[str]:
        checks = {
            "superuser": self.is_superuser,
            "bypassrls": self.bypass_rls,
            "createrole": self.create_role,
            "createdb": self.create_db,
            "owns_relations": self.owned_relations > 0,
            "owns_schemas": self.owned_schemas > 0,
            "owns_database": self.owns_database,
            "can_create_in_public": self.can_create_in_public,
            "member_of_app_owner": self.member_of_owner,
        }
        return [name for name, failed in checks.items() if failed]


async def inspect_current_role(connection: AsyncConnection) -> RoleReport:
    row = (await connection.execute(_INSPECT_SQL)).mappings().one()
    return RoleReport(
        role_name=row["role_name"],
        is_superuser=bool(row["is_superuser"]),
        bypass_rls=bool(row["bypass_rls"]),
        create_role=bool(row["create_role"]),
        create_db=bool(row["create_db"]),
        owned_relations=int(row["owned_relations"]),
        owned_schemas=int(row["owned_schemas"]),
        owns_database=bool(row["owns_database"]),
        can_create_in_public=bool(row["can_create_in_public"]),
        member_of_owner=bool(row["member_of_owner"]),
    )


async def verify_runtime_role(engine: AsyncEngine, *, enforce: bool) -> list[str]:
    """Inspect the engine's role; raise if unsafe and ``enforce`` is set.

    Returns the list of violations (empty when safe). Connection errors propagate so
    callers can distinguish "unsafe" from "could not check".
    """
    async with engine.connect() as connection:
        report = await inspect_current_role(connection)
    violations = report.violations()
    if violations:
        logger.error(
            "database role is unsafe for runtime use",
            extra={"event": "db.role_check", "outcome": "unsafe", "violations": violations},
        )
        if enforce:
            raise UnsafeDatabaseRoleError(report.role_name, violations)
    return violations
