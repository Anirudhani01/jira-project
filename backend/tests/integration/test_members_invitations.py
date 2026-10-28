"""M4: invitations and member management (plan M4, R4, R7-M4, D1, V3.6).

API flows run end to end (API -> outbox -> worker -> Mailpit -> accept). Database-level
assertions run as the restricted runtime roles only.
"""

import asyncio
import hashlib
import json
import uuid
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack

import httpx
import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from app.db.tenant import TenantContext, bind_invite_token, bind_tenant
from tests.integration.auth_support import (
    auth_client,
    csrf,
    flush_test_redis,
    login,
    signup,
    superuser_sql,
    unique_email,
)
from tests.integration.email_support import mailpit_messages, run_worker, token_from
from tests.integration.tenancy_support import Tenant, add_member, denied, make_tenant, verified_user


@pytest.fixture(autouse=True)
async def _clean_rate_limits() -> None:
    await flush_test_redis()


@pytest.fixture
async def tenant() -> AsyncIterator[Tenant]:
    async with AsyncExitStack() as stack:
        yield await make_tenant(stack)


async def invite(
    actor: httpx.AsyncClient, slug: str, email: str, role: str = "member"
) -> httpx.Response:
    return await actor.post(
        f"/api/v1/orgs/{slug}/invitations",
        json={"email": email, "role": role},
        headers={"X-CSRF-Token": await csrf(actor)},
    )


async def accept(http: httpx.AsyncClient, token: str) -> httpx.Response:
    return await http.post(
        "/api/v1/invitations/accept",
        json={"token": token},
        headers={"X-CSRF-Token": await csrf(http)},
    )


async def patch_member(
    actor: httpx.AsyncClient, slug: str, user_id: uuid.UUID, **body: object
) -> httpx.Response:
    return await actor.patch(
        f"/api/v1/orgs/{slug}/members/{user_id}",
        json=body,
        headers={"X-CSRF-Token": await csrf(actor)},
    )


async def remove(actor: httpx.AsyncClient, slug: str, user_id: uuid.UUID) -> httpx.Response:
    return await actor.delete(
        f"/api/v1/orgs/{slug}/members/{user_id}", headers={"X-CSRF-Token": await csrf(actor)}
    )


async def invitation_token(email: str) -> str:
    await run_worker()
    messages = [m for m in await mailpit_messages(email) if m["Subject"].startswith("Invitation")]
    assert messages, "no invitation email"
    return token_from(messages[-1], "/accept")


async def member_client(
    stack: AsyncExitStack, tenant: Tenant, role: str
) -> tuple[httpx.AsyncClient, uuid.UUID]:
    http = await stack.enter_async_context(auth_client())
    await flush_test_redis()
    _, user_id = await verified_user(http)
    await add_member(tenant.org_id, user_id, role)
    return http, user_id


# ----------------------------------------------------------------------- invitations
async def test_invite_email_accept_and_audit(tenant: Tenant) -> None:
    async with auth_client() as invitee:
        email, user_id = await verified_user(invitee)
        assert (await invite(tenant.http, tenant.slug, email, "admin")).status_code == 202
        token = await invitation_token(email)
        joined = await accept(invitee, token)
        assert joined.status_code == 200
        assert joined.json() == {"slug": tenant.slug, "name": "Acme", "role": "admin"}
        assert (await invitee.get(f"/api/v1/orgs/{tenant.slug}")).json()["role"] == "admin"
        again = await accept(invitee, token)
        assert again.status_code == 410  # single use
    [stored] = await superuser_sql(
        "SELECT token_hash, accepted_by FROM org_invitations WHERE email = :e", e=email
    )
    assert bytes(stored.token_hash) == hashlib.sha256(token.encode()).digest()
    assert stored.accepted_by == user_id
    actions = await superuser_sql(
        "SELECT action FROM audit_events WHERE org_id = :o ORDER BY id", o=tenant.org_id
    )
    assert [a.action for a in actions] == ["org.created", "org.member.invited", "org.member.joined"]


async def test_accept_requires_matching_verified_email(tenant: Tenant) -> None:
    target = unique_email()
    await invite(tenant.http, tenant.slug, target)
    token = await invitation_token(target)
    async with auth_client() as stranger:
        await verified_user(stranger)
        response = await accept(stranger, token)
        assert response.status_code == 403
        assert response.json()["code"] == "invitation_email_mismatch"
    await flush_test_redis()
    async with auth_client() as unverified:
        await signup(unverified, target)
        await login(unverified, target)
        response = await accept(unverified, token)
        assert response.status_code == 403
        assert response.json()["code"] == "email_unverified"
    [row] = await superuser_sql(
        "SELECT accepted_at FROM org_invitations WHERE email = :e", e=target
    )
    assert row.accepted_at is None


@pytest.mark.parametrize("state", ["expired", "revoked"])
async def test_expired_or_revoked_invitations_are_gone(tenant: Tenant, state: str) -> None:
    async with auth_client() as invitee:
        email, _ = await verified_user(invitee)
        await invite(tenant.http, tenant.slug, email)
        token = await invitation_token(email)
        if state == "expired":
            await superuser_sql(
                "UPDATE org_invitations SET expires_at = now() - interval '1 second' "
                "WHERE email = :e",
                e=email,
            )
        else:
            [inv] = await superuser_sql("SELECT id FROM org_invitations WHERE email = :e", e=email)
            revoked = await tenant.http.delete(
                f"/api/v1/orgs/{tenant.slug}/invitations/{inv.id}",
                headers=await tenant.headers(),
            )
            assert revoked.status_code == 204
        response = await accept(invitee, token)
        assert response.status_code == 410
        assert (await invitee.get(f"/api/v1/orgs/{tenant.slug}")).status_code == 404


async def test_unknown_token_is_404(tenant: Tenant) -> None:
    assert (await accept(tenant.http, "Z" * 43)).status_code == 404


async def test_invitation_permissions(tenant: Tenant) -> None:
    async with AsyncExitStack() as stack:
        admin, _ = await member_client(stack, tenant, "admin")
        member, _ = await member_client(stack, tenant, "member")
        assert (await invite(admin, tenant.slug, unique_email(), "owner")).status_code == 403
        assert (await invite(admin, tenant.slug, unique_email(), "admin")).status_code == 202
        assert (await invite(member, tenant.slug, unique_email())).status_code == 403
        outsider = await stack.enter_async_context(auth_client())
        await verified_user(outsider)
        assert (await invite(outsider, tenant.slug, unique_email())).status_code == 404
        listing = await member.get(f"/api/v1/orgs/{tenant.slug}/invitations")
        assert listing.status_code == 403
    assert (await invite(tenant.http, tenant.slug, unique_email(), "owner")).status_code == 202


async def test_duplicate_pending_invitation_and_existing_member_conflict(tenant: Tenant) -> None:
    email = unique_email()
    assert (await invite(tenant.http, tenant.slug, email)).status_code == 202
    duplicate = await invite(tenant.http, tenant.slug, email.upper())
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "invitation_pending"
    existing = await invite(tenant.http, tenant.slug, tenant.email)
    assert existing.json()["code"] == "already_member"


async def test_invitations_are_limited_per_org_per_day(tenant: Tenant) -> None:
    statuses = [
        (await invite(tenant.http, tenant.slug, unique_email())).status_code for _ in range(100)
    ]
    assert set(statuses) == {202}
    assert (await invite(tenant.http, tenant.slug, unique_email())).status_code == 429


async def test_invitation_job_is_a_tenant_job_and_payload_holds_ids_only(tenant: Tenant) -> None:
    email = unique_email()
    await invite(tenant.http, tenant.slug, email)
    [job] = await superuser_sql(
        "SELECT org_id, payload::text AS payload FROM outbox "
        "WHERE topic = 'email.org_invitation' ORDER BY id DESC LIMIT 1"
    )
    assert job.org_id == tenant.org_id
    assert email not in job.payload
    assert set(json.loads(job.payload)) == {"invitation_id"}


# ------------------------------------------------------------------ member changes
async def test_role_changes_and_owner_rules(tenant: Tenant) -> None:
    async with AsyncExitStack() as stack:
        admin, admin_id = await member_client(stack, tenant, "admin")
        _, member_id = await member_client(stack, tenant, "member")
        assert (await patch_member(admin, tenant.slug, member_id, role="admin")).status_code == 204
        assert (await patch_member(admin, tenant.slug, member_id, role="owner")).status_code == 403
        assert (
            await patch_member(admin, tenant.slug, tenant.user_id, role="member")
        ).status_code == 403
        assert (await remove(admin, tenant.slug, tenant.user_id)).status_code == 403
        assert (
            await patch_member(tenant.http, tenant.slug, admin_id, role="owner")
        ).status_code == 204
        listing = (await tenant.http.get(f"/api/v1/orgs/{tenant.slug}/members")).json()["items"]
        assert {m["user_id"]: m["role"] for m in listing} == {
            str(tenant.user_id): "owner",
            str(admin_id): "owner",
            str(member_id): "admin",
        }
    events = await superuser_sql(
        "SELECT metadata::text AS md FROM audit_events WHERE org_id = :o "
        "AND action = 'org.member.role_changed' ORDER BY id",
        o=tenant.org_id,
    )
    assert [e.md for e in events] == [
        '{"new_role": "admin", "old_role": "member"}',
        '{"new_role": "owner", "old_role": "admin"}',
    ]


async def test_last_owner_cannot_be_demoted_or_removed(tenant: Tenant) -> None:
    response = await patch_member(tenant.http, tenant.slug, tenant.user_id, role="admin")
    assert response.status_code == 409
    assert response.json()["code"] == "last_owner"
    assert (await remove(tenant.http, tenant.slug, tenant.user_id)).json()["code"] == "last_owner"


async def test_concurrent_demotion_of_two_owners_leaves_one(tenant: Tenant) -> None:
    """Plan R4: two owners demote each other concurrently -> exactly one succeeds."""
    async with AsyncExitStack() as stack:
        second, second_id = await member_client(stack, tenant, "owner")
        results = await asyncio.gather(
            patch_member(tenant.http, tenant.slug, second_id, role="member"),
            patch_member(second, tenant.slug, tenant.user_id, role="member"),
        )
    assert sorted(r.status_code for r in results) == [204, 409]
    [owners] = await superuser_sql(
        "SELECT count(*) AS n FROM org_memberships WHERE org_id = :o AND role = 'owner' "
        "AND removed_at IS NULL",
        o=tenant.org_id,
    )
    assert owners.n == 1


async def test_last_owner_trigger_backs_up_the_service_at_commit(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    error = await denied(
        rw_engine,
        "UPDATE org_memberships SET role = 'admin' WHERE org_id = :o AND user_id = :u",
        org_id=tenant.org_id,
        user_id=tenant.user_id,
        commit=True,
        o=tenant.org_id,
        u=tenant.user_id,
    )
    assert "organization must keep an owner" in error


async def test_removed_member_loses_access_and_reinvite_reactivates(tenant: Tenant) -> None:
    async with AsyncExitStack() as stack:
        member, member_id = await member_client(stack, tenant, "member")
        assert (await member.get(f"/api/v1/orgs/{tenant.slug}")).status_code == 200
        assert (await remove(tenant.http, tenant.slug, member_id)).status_code == 204
        assert (await member.get(f"/api/v1/orgs/{tenant.slug}")).status_code == 404
        assert (await remove(tenant.http, tenant.slug, member_id)).status_code == 404
        [row] = await superuser_sql("SELECT email FROM users WHERE id = :u", u=member_id)
        await invite(tenant.http, tenant.slug, row.email, "admin")
        token = await invitation_token(row.email)
        assert (await accept(member, token)).status_code == 200
        assert (await member.get(f"/api/v1/orgs/{tenant.slug}")).json()["role"] == "admin"
    [count] = await superuser_sql(
        "SELECT count(*) AS n FROM org_memberships WHERE org_id = :o AND user_id = :u",
        o=tenant.org_id,
        u=member_id,
    )
    assert count.n == 1  # same row reactivated


async def test_project_creation_grant_is_managed_and_audited(tenant: Tenant) -> None:
    """D9 Option B: owners/admins grant can_create_projects; members cannot self-grant."""
    async with AsyncExitStack() as stack:
        member, member_id = await member_client(stack, tenant, "member")
        own = await patch_member(member, tenant.slug, member_id, can_create_projects=True)
        assert own.status_code == 403
        assert (
            await patch_member(tenant.http, tenant.slug, member_id, can_create_projects=True)
        ).status_code == 204
        org = (await member.get(f"/api/v1/orgs/{tenant.slug}")).json()
        assert "project.create" in org["permissions"]
        assert (
            await patch_member(tenant.http, tenant.slug, member_id, can_create_projects=False)
        ).status_code == 204
        org = (await member.get(f"/api/v1/orgs/{tenant.slug}")).json()
        assert "project.create" not in org["permissions"]
    events = await superuser_sql(
        "SELECT metadata::text AS md FROM audit_events WHERE org_id = :o "
        "AND action = 'org.member.permission_changed' ORDER BY id",
        o=tenant.org_id,
    )
    assert [e.md for e in events] == [
        '{"granted": true, "permission": "can_create_projects"}',
        '{"granted": false, "permission": "can_create_projects"}',
    ]


async def test_members_list_is_visible_to_members_not_outsiders(tenant: Tenant) -> None:
    async with AsyncExitStack() as stack:
        member, _ = await member_client(stack, tenant, "member")
        assert (await member.get(f"/api/v1/orgs/{tenant.slug}/members")).status_code == 200
        outsider = await stack.enter_async_context(auth_client())
        await verified_user(outsider)
        assert (await outsider.get(f"/api/v1/orgs/{tenant.slug}/members")).status_code == 404


# -------------------------------------------------------------- database boundaries
async def test_membership_via_invitation_requires_bound_token_and_matching_email(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    target = unique_email()
    await invite(tenant.http, tenant.slug, target, "admin")
    token = await invitation_token(target)
    async with auth_client() as stranger:
        _, stranger_id = await verified_user(stranger)
    statement = "INSERT INTO org_memberships (org_id, user_id, role) VALUES (:o, :u, :r)"
    # Right token, wrong user (email mismatch): rejected by RLS.
    async with AsyncSession(bind=rw_engine) as session:
        await session.begin()
        await bind_invite_token(session, hashlib.sha256(token.encode()).digest())
        await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=stranger_id))
        with pytest.raises(Exception, match="row-level security"):
            await session.execute(
                text(statement), {"o": tenant.org_id, "u": stranger_id, "r": "admin"}
            )
        await session.rollback()
    # No token bound: rejected.
    error = await denied(
        rw_engine,
        statement,
        org_id=tenant.org_id,
        user_id=stranger_id,
        o=tenant.org_id,
        u=stranger_id,
        r="member",
    )
    assert "row-level security" in error


async def test_invitations_are_invisible_across_tenants_and_to_members(
    rw_engine: AsyncEngine, tenant: Tenant
) -> None:
    await invite(tenant.http, tenant.slug, unique_email())
    async with AsyncExitStack() as stack:
        other = await make_tenant(stack, "other")
        _, member_id = await member_client(stack, tenant, "member")
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=other.org_id, user_id=other.user_id))
        assert (
            await session.execute(
                text("SELECT count(*) FROM org_invitations WHERE org_id = :o"), {"o": tenant.org_id}
            )
        ).scalar_one() == 0
    async with AsyncSession(bind=rw_engine) as session, session.begin():
        await bind_tenant(session, TenantContext(org_id=tenant.org_id, user_id=member_id))
        assert (
            await session.execute(text("SELECT count(*) FROM org_invitations"))
        ).scalar_one() == 0


async def test_worker_dead_letters_malformed_tenant_and_platform_jobs() -> None:
    """Tenant job without org and platform job carrying an org are both permanent errors."""
    [tenant_job] = await superuser_sql(
        "INSERT INTO outbox (topic, payload) VALUES ('email.org_invitation', "
        "jsonb_build_object('invitation_id', gen_random_uuid()::text)) RETURNING id"
    )
    [org] = await superuser_sql("SELECT id FROM organizations LIMIT 1")
    [platform_job] = await superuser_sql(
        "INSERT INTO outbox (org_id, topic, payload) VALUES (:o, 'email.verify', "
        "jsonb_build_object('user_id', gen_random_uuid()::text)) RETURNING id",
        o=org.id,
    )
    await run_worker()
    rows = await superuser_sql(
        "SELECT id, dead_at, last_error FROM outbox WHERE id IN (:a, :b)",
        a=tenant_job.id,
        b=platform_job.id,
    )
    assert all(r.dead_at is not None and r.last_error == "PermanentJobError" for r in rows)
    assert len(rows) == 2
