"""Member management and invitations (M4, plan R4, D1, V3.6).

- Role changes and removals take the per-org lock (``organizations`` row FOR UPDATE),
  then re-check the last-owner rule: the last active owner cannot be demoted or removed
  (409 ``last_owner``). A deferred trigger backs this up at COMMIT.
- Only owners may grant, change or revoke the owner role or touch owner rows; admins
  manage admins and members (also enforced by RLS).
- Removal is soft (``removed_at``): access ends with the next statement, the history stays.
- Invitations: owners/admins invite an email with a role (admins cannot invite owners).
  The worker mints the single-use token and emails it; it expires after 7 days.
  Accepting requires a session whose **verified** email matches the invitation (D1).
"""

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy.exc import IntegrityError

from app.authz.deps import OrgAccess, not_found, org_transaction
from app.authz.permissions import Permission
from app.core.errors import AppError
from app.core.rate_limit import INVITATIONS_PER_ORG
from app.core.security import hash_token
from app.db.tenant import TenantContext, bind_invite_token, bind_tenant
from app.modules.audit import service as audit
from app.modules.identity import service as identity
from app.modules.identity.deps import AuthContext, IdentityServices
from app.modules.orgs import repository
from app.modules.orgs.models import INVITATION_TTL_DAYS
from app.modules.orgs.repository import MemberRow
from app.modules.outbox import service as outbox
from app.modules.security_events.service import ClientInfo

TOPIC_ORG_INVITATION = "email.org_invitation"


def owner_only() -> AppError:
    return AppError(403, "forbidden", "Only owners can manage owners.")


def last_owner() -> AppError:
    return AppError(409, "last_owner", "An organization must keep at least one owner.")


async def list_members(services: IdentityServices, access: OrgAccess) -> list[MemberRow]:
    async with org_transaction(services, access, Permission.ORG_VIEW) as (session, _):
        return await repository.list_members(session)


@dataclass(frozen=True, slots=True)
class MemberChange:
    role: str | None = None
    can_create_projects: bool | None = None


async def change_member(
    services: IdentityServices,
    access: OrgAccess,
    user_id: uuid.UUID,
    change: MemberChange,
    client: ClientInfo,
) -> None:
    async with org_transaction(services, access, Permission.ORG_MEMBERS_MANAGE) as (
        session,
        current,
    ):
        await repository.lock_org(session)
        target = await repository.get_member(session, user_id)
        if target is None or target.removed_at is not None:
            raise not_found()
        # Snapshot first: ORM-enabled UPDATEs synchronise the loaded object.
        old_role, old_grant = target.role, target.can_create_projects
        touches_owner = old_role == "owner" or change.role == "owner"
        if touches_owner and current.role != "owner":
            raise owner_only()
        if change.role is not None and change.role != old_role:
            if old_role == "owner" and await repository.count_active_owners(session) <= 1:
                raise last_owner()
            await repository.update_member(session, user_id, role=change.role)
            await audit.record(
                session,
                "org.member.role_changed",
                client,
                actor_user_id=current.user_id,
                target_type="user",
                target_id=str(user_id),
                metadata={"old_role": old_role, "new_role": change.role},
            )
        if change.can_create_projects is not None and change.can_create_projects != old_grant:
            await repository.update_member(
                session, user_id, can_create_projects=change.can_create_projects
            )
            await audit.record(
                session,
                "org.member.permission_changed",
                client,
                actor_user_id=current.user_id,
                target_type="user",
                target_id=str(user_id),
                metadata={
                    "permission": "can_create_projects",
                    "granted": change.can_create_projects,
                },
            )


async def remove_member(
    services: IdentityServices, access: OrgAccess, user_id: uuid.UUID, client: ClientInfo
) -> None:
    async with org_transaction(services, access, Permission.ORG_MEMBERS_MANAGE) as (
        session,
        current,
    ):
        await repository.lock_org(session)
        target = await repository.get_member(session, user_id)
        if target is None or target.removed_at is not None:
            raise not_found()
        removed_role = target.role
        if removed_role == "owner":
            if current.role != "owner":
                raise owner_only()
            if await repository.count_active_owners(session) <= 1:
                raise last_owner()
        await repository.remove_member_effects(session, user_id)
        await repository.update_member(
            session, user_id, removed_at=repository.now(), can_create_projects=False
        )
        await audit.record(
            session,
            "org.member.removed",
            client,
            actor_user_id=current.user_id,
            target_type="user",
            target_id=str(user_id),
            metadata={"role": removed_role},
        )


# ----------------------------------------------------------------------- invitations
async def create_invitation(
    services: IdentityServices, access: OrgAccess, *, email: str, role: str, client: ClientInfo
) -> uuid.UUID:
    await identity.reserve_rate_limit(services, INVITATIONS_PER_ORG, str(access.org_id), client)
    invitation_id = uuid.uuid4()
    try:
        async with org_transaction(services, access, Permission.ORG_MEMBERS_MANAGE) as (
            session,
            current,
        ):
            if role == "owner" and current.role != "owner":
                raise owner_only()
            if await repository.active_member_with_email(session, email):
                raise AppError(409, "already_member", "This person is already a member.")
            await repository.revoke_expired_invitations(session, email)
            await repository.insert_invitation(
                session,
                invitation_id=invitation_id,
                email=email,
                role=role,
                invited_by=current.user_id,
                ttl_days=INVITATION_TTL_DAYS,
            )
            await outbox.enqueue(
                session,
                TOPIC_ORG_INVITATION,
                {"invitation_id": invitation_id},
                org_id=current.org_id,
            )
            await audit.record(
                session,
                "org.member.invited",
                client,
                actor_user_id=current.user_id,
                target_type="invitation",
                target_id=str(invitation_id),
                metadata={"role": role},
            )
    except IntegrityError as exc:
        if "uq_org_invitations_org_id_email_pending" in str(exc.orig):
            raise AppError(
                409, "invitation_pending", "An invitation for this email is already pending."
            ) from None
        raise
    return invitation_id


async def list_invitations(services: IdentityServices, access: OrgAccess) -> list[Any]:
    async with org_transaction(services, access, Permission.ORG_MEMBERS_MANAGE) as (session, _):
        return list(await repository.list_pending_invitations(session))


async def revoke_invitation(
    services: IdentityServices, access: OrgAccess, invitation_id: uuid.UUID, client: ClientInfo
) -> None:
    async with org_transaction(services, access, Permission.ORG_MEMBERS_MANAGE) as (
        session,
        current,
    ):
        revoked = await repository.revoke_invitation(session, invitation_id)
        if revoked is None:
            raise not_found()
        if revoked.role == "owner" and current.role != "owner":
            raise owner_only()  # RLS would also hide it; keep the answer explicit
        await audit.record(
            session,
            "org.invitation.revoked",
            client,
            actor_user_id=current.user_id,
            target_type="invitation",
            target_id=str(invitation_id),
        )


@dataclass(frozen=True, slots=True)
class Joined:
    slug: str
    name: str
    role: str


def invitation_unavailable() -> AppError:
    return AppError(410, "invitation_unavailable", "This invitation has expired or was used.")


async def accept_invitation(
    services: IdentityServices, auth: AuthContext, *, token: str, client: ClientInfo
) -> Joined:
    user = await identity.get_user(services, auth.user_id)
    async with services.sessionmaker() as session, session.begin():
        await bind_invite_token(session, hash_token(token))
        invitation = await repository.find_invitation_by_bound_token(session)
        if invitation is None:
            raise AppError(404, "not_found")
        if invitation.accepted_at or invitation.revoked_at or invitation.expired:
            raise invitation_unavailable()
        if user.email_verified_at is None:
            raise AppError(403, "email_unverified", "Verify your email address before joining.")
        if user.email.lower() != str(invitation.email).lower():
            raise AppError(
                403,
                "invitation_email_mismatch",
                "This invitation was sent to a different email address.",
            )
        await bind_tenant(session, TenantContext(org_id=invitation.org_id, user_id=user.id))
        existing = await repository.get_member(session, user.id)
        if existing is not None and existing.removed_at is None:
            raise AppError(409, "already_member", "You are already a member.")
        if existing is not None:  # re-invited after removal: reactivate the same row
            await repository.update_member(
                session, user.id, role=invitation.role, removed_at=None, can_create_projects=False
            )
        else:
            await repository.insert_membership(session, user_id=user.id, role=invitation.role)
        await repository.mark_invitation_accepted(session, invitation.id, user.id)
        await audit.record(
            session,
            "org.member.joined",
            client,
            actor_user_id=user.id,
            target_type="invitation",
            target_id=str(invitation.id),
            metadata={"role": invitation.role},
        )
        # The organization becomes visible to the invitee only now that they are a member.
        org = await repository.get_org(session)
        return Joined(slug=org.slug, name=org.name, role=invitation.role)
