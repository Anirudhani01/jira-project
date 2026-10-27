"""Tenant context binding for PostgreSQL row-level security.

This is the ONLY module allowed to set ``app.*`` session settings (enforced by
``tests/unit/test_architecture.py``). Settings are bound with ``set_config(..., true)``,
i.e. transaction-local, so they vanish at commit/rollback and cannot leak to the next
user of a pooled connection.

RLS is defense in depth, not a complete boundary: any code holding a connection can
call ``set_config``. See docs/adr/0003-tenancy-shared-schema-rls.md for the trust model.

M0 provides the infrastructure only; no routes bind a tenant yet.
"""

from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


class TenantContextError(RuntimeError):
    """Raised when tenant context is missing or bound incorrectly."""


@dataclass(frozen=True, slots=True)
class TenantContext:
    org_id: UUID | None
    user_id: UUID | None


_BIND_SQL = text(
    "SELECT set_config('app.org_id', :org_id, true), set_config('app.user_id', :user_id, true)"
)


_BIND_AUTH_EMAIL_SQL = text("SELECT set_config('app.auth_email', :email, true)")


async def bind_auth_email(session: AsyncSession, email: str) -> None:
    """Allow the ``users`` RLS policy to expose the single row matching ``email``.

    Used only by signup/login (and the dev CLI) before a user identity is known.
    Transaction-local like all other context.
    """
    if not session.in_transaction():
        raise TenantContextError("auth context must be bound inside an explicit transaction")
    await session.execute(_BIND_AUTH_EMAIL_SQL, {"email": email})


async def bind_tenant(session: AsyncSession, context: TenantContext) -> None:
    """Bind tenant/user context for the current transaction.

    Must be called after ``session.begin()``; binding outside an explicit transaction
    would apply to an implicit transaction with an unclear lifetime.
    """
    if context.org_id is None and context.user_id is None:
        raise TenantContextError("tenant context requires an org_id or user_id")
    if not session.in_transaction():
        raise TenantContextError("tenant context must be bound inside an explicit transaction")
    await session.execute(
        _BIND_SQL,
        {
            # Empty string means "unset": app_current_org()/app_current_user() return NULL.
            "org_id": str(context.org_id) if context.org_id else "",
            "user_id": str(context.user_id) if context.user_id else "",
        },
    )
