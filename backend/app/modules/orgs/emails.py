"""Invitation emails (M4), executed by the worker for the job's org (tenant topic).

The worker binds the org recorded on the outbox row (never one from the payload), mints
the invitation token at send time and stores only its SHA-256 hash. A token is minted
once per invitation: a redelivered job finds it already set and sends nothing (no
duplicate emails); if sending fails, the hash is cleared so the retry mints a new token.
"""

import uuid
from typing import Literal

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings
from app.core.mailer import Mailer, OutgoingEmail
from app.core.security import hash_token, new_session_token
from app.db.tenant import bind_job_context
from app.modules.orgs.models import Organization, OrgInvitation

Outcome = Literal["sent", "skipped"]


async def handle_invitation_job(
    *,
    job_id: int,
    org_id: uuid.UUID,
    invitation_id: uuid.UUID,
    settings: Settings,
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
) -> Outcome:
    token = new_session_token()
    token_hash = hash_token(token)
    async with sessionmaker() as session, session.begin():
        await bind_job_context(session, org_id)
        row = (
            await session.execute(
                select(OrgInvitation.email, OrgInvitation.role, Organization.name)
                .join(Organization, Organization.id == OrgInvitation.org_id)
                .where(
                    OrgInvitation.id == invitation_id,
                    OrgInvitation.org_id == org_id,
                    OrgInvitation.accepted_at.is_(None),
                    OrgInvitation.revoked_at.is_(None),
                    OrgInvitation.expires_at > func.now(),
                    OrgInvitation.token_hash.is_(None),
                )
            )
        ).one_or_none()
        if row is None:  # revoked, expired, accepted or already sent
            return "skipped"
        await session.execute(
            update(OrgInvitation)
            .where(OrgInvitation.id == invitation_id, OrgInvitation.token_hash.is_(None))
            .values(token_hash=token_hash)
        )
    base = settings.app_base_url.rstrip("/")
    body = (
        f"You have been invited to join {row.name} as {row.role}.\n\n"
        f"Accept the invitation (sign in with this email address first):\n\n"
        f"{base}/invitations/accept#token={token}\n\n"
        "The invitation expires in 7 days and can be used once. If you were not expecting "
        "it, you can ignore this email.\n"
    )
    try:
        await mailer.send(
            OutgoingEmail(
                to=row.email,
                subject=f"Invitation to join {row.name}",
                body=body,
                idempotency_key=f"outbox-{job_id}",
            )
        )
    except Exception:
        async with sessionmaker() as session, session.begin():
            await bind_job_context(session, org_id)
            await session.execute(
                update(OrgInvitation)
                .where(OrgInvitation.id == invitation_id, OrgInvitation.token_hash == token_hash)
                .values(token_hash=None)
            )
        raise
    return "sent"
