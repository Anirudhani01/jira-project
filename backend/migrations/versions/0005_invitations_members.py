"""Invitations and member management (M4).

- ``org_invitations``: invite by email + role, 7-day expiry, single use. The token is
  minted by the worker at send time (only its SHA-256 hash is stored, R2/R4).
  ``app_rw`` sees invitations of orgs it manages, or the single invitation whose token
  hash is bound in ``app.invite_token_hash`` (accept flow). Only owners may invite owners.
- Accepting: the invitee may insert (or reactivate) *their own* membership only with the
  role of a pending, unexpired invitation bound by token hash whose email matches their
  own **verified** address (``app_invitation_allows``).
- Last-owner protection backstop: a deferred constraint trigger rejects, at COMMIT, any
  membership change that leaves an organization without an active owner (the service
  also takes a per-org lock and answers 409 first, plan R4).

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"
MANAGERS = "ARRAY['owner', 'admin']"
DEFINER = "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp"

# M3 membership write rule (unchanged) and the M4 invitation branches.
WRITE_RULE = (
    "app_has_org_role(org_id, ARRAY['owner']) "
    "OR (app_has_org_role(org_id, ARRAY['admin']) AND role <> 'owner')"
)
M3_INSERT = (
    "org_id = app_current_org() AND ("
    "(user_id = app_current_user() AND role = 'owner' AND app_can_claim_initial_owner(org_id)) "
    f"OR {WRITE_RULE})"
)
M3_UPDATE = f"org_id = app_current_org() AND ({WRITE_RULE})"
ACCEPT = (
    "(user_id = app_current_user() AND NOT can_create_projects "
    "AND app_invitation_allows(org_id, role))"
)


def upgrade() -> None:
    op.create_table(
        "org_invitations",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=True),
        sa.Column("invited_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'member')", name="ck_org_invitations_role_valid"
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name="fk_org_invitations_org_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "invited_by"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_org_invitations_org_id_org_memberships",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "accepted_by"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_org_invitations_org_id_accepted_by_org_memberships",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_org_invitations"),
        sa.UniqueConstraint("org_id", "id", name="uq_org_invitations_org_id_id"),
        sa.UniqueConstraint("token_hash", name="uq_org_invitations_token_hash"),
    )
    op.create_index(
        "uq_org_invitations_org_id_email_pending",
        "org_invitations",
        ["org_id", "email"],
        unique=True,
        postgresql_where=sa.text("accepted_at IS NULL AND revoked_at IS NULL"),
    )

    op.execute(
        """
        CREATE FUNCTION app_invite_token_hash() RETURNS bytea
        LANGUAGE sql STABLE PARALLEL SAFE AS $$
          SELECT decode(NULLIF(current_setting('app.invite_token_hash', true), ''), 'hex')
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_invitation_allows(org uuid, member_role text) RETURNS boolean
        {DEFINER} AS $$
          SELECT EXISTS (
            SELECT 1 FROM org_invitations i JOIN users u ON u.id = app_current_user()
             WHERE i.token_hash = app_invite_token_hash() AND i.org_id = org
               AND i.role = member_role AND i.accepted_at IS NULL AND i.revoked_at IS NULL
               AND i.expires_at > now() AND u.email = i.email
               AND u.email_verified_at IS NOT NULL AND u.status = 'active')
        $$
        """
    )
    for function in ("app_invite_token_hash()", "app_invitation_allows(uuid, text)"):
        op.execute(f"REVOKE ALL ON FUNCTION {function} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {function} TO {RUNTIME_ROLES}")
    # The definer helper reads invitations and users regardless of the caller's RLS.
    op.execute("CREATE POLICY users_helpers ON users FOR SELECT TO app_owner USING (true)")

    op.execute("ALTER TABLE org_invitations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE org_invitations FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY org_invitations_helpers ON org_invitations FOR SELECT TO app_owner "
        "USING (true)"
    )
    manage = (
        f"org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS}) "
        "AND (role <> 'owner' OR app_has_org_role(org_id, ARRAY['owner']))"
    )
    op.execute(
        "CREATE POLICY org_invitations_select ON org_invitations FOR SELECT TO app_rw "
        f"USING (({manage}) OR token_hash = app_invite_token_hash())"
    )
    op.execute(
        "CREATE POLICY org_invitations_insert ON org_invitations FOR INSERT TO app_rw "
        f"WITH CHECK ({manage} AND invited_by = app_current_user() AND token_hash IS NULL)"
    )
    op.execute(
        "CREATE POLICY org_invitations_update ON org_invitations FOR UPDATE TO app_rw "
        f"USING (({manage}) OR (org_id = app_current_org() "
        "AND token_hash = app_invite_token_hash())) "
        "WITH CHECK (org_id = app_current_org())"
    )
    op.execute(
        "CREATE POLICY org_invitations_worker ON org_invitations FOR ALL TO app_worker "
        "USING (org_id = app_current_org()) WITH CHECK (org_id = app_current_org())"
    )
    op.execute(f"REVOKE ALL ON org_invitations FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON org_invitations TO app_rw")
    op.execute("GRANT UPDATE (revoked_at, accepted_at, accepted_by) ON org_invitations TO app_rw")
    op.execute("GRANT SELECT, UPDATE (token_hash) ON org_invitations TO app_worker")

    # Memberships: add the invitation branches (insert / reactivate own membership).
    op.execute("DROP POLICY org_memberships_insert ON org_memberships")
    op.execute("DROP POLICY org_memberships_update ON org_memberships")
    op.execute(
        "CREATE POLICY org_memberships_insert ON org_memberships FOR INSERT TO app_rw "
        f"WITH CHECK (({M3_INSERT}) OR (org_id = app_current_org() AND {ACCEPT}))"
    )
    op.execute(
        "CREATE POLICY org_memberships_update ON org_memberships FOR UPDATE TO app_rw "
        f"USING (({M3_UPDATE}) OR (org_id = app_current_org() "
        "AND user_id = app_current_user() AND removed_at IS NOT NULL)) "
        f"WITH CHECK (({M3_UPDATE}) OR (org_id = app_current_org() "
        f"AND removed_at IS NULL AND {ACCEPT}))"
    )

    # Last-owner backstop (plan R4): checked at COMMIT for every membership update.
    op.execute(
        """
        CREATE FUNCTION app_check_org_keeps_owner() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM org_memberships m
                          WHERE m.org_id = NEW.org_id AND m.role = 'owner'
                            AND m.removed_at IS NULL) THEN
            RAISE EXCEPTION 'organization must keep an owner'
              USING ERRCODE = 'check_violation', CONSTRAINT = 'org_keeps_owner';
          END IF;
          RETURN NULL;
        END
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION app_check_org_keeps_owner() FROM PUBLIC")
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER org_keeps_owner AFTER UPDATE ON org_memberships
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
        WHEN (OLD.role = 'owner' AND (NEW.role <> 'owner' OR NEW.removed_at IS NOT NULL))
        EXECUTE FUNCTION app_check_org_keeps_owner()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER org_keeps_owner ON org_memberships")
    op.execute("DROP FUNCTION app_check_org_keeps_owner()")
    op.execute("DROP POLICY org_memberships_insert ON org_memberships")
    op.execute("DROP POLICY org_memberships_update ON org_memberships")
    op.execute(
        "CREATE POLICY org_memberships_insert ON org_memberships FOR INSERT TO app_rw "
        f"WITH CHECK ({M3_INSERT})"
    )
    op.execute(
        "CREATE POLICY org_memberships_update ON org_memberships FOR UPDATE TO app_rw "
        f"USING ({M3_UPDATE}) WITH CHECK ({M3_UPDATE})"
    )
    op.drop_index("uq_org_invitations_org_id_email_pending", table_name="org_invitations")
    op.drop_table("org_invitations")
    op.execute("DROP POLICY users_helpers ON users")
    op.execute("DROP FUNCTION app_invitation_allows(uuid, text)")
    op.execute("DROP FUNCTION app_invite_token_hash()")
