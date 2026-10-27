"""Organizations and tenancy (M3): orgs, memberships, seeded configuration, org audit,
outbox tenant scope, and the RLS policies that bind them to the caller's membership.

Policy design (plan R3.1/R3.2, refined):
- Every tenant table has FORCED RLS. Policies for the API role (``app_rw``) require the
  bound org *and* an active membership of the bound user in it; writes additionally require
  the right role. Policies for the worker role (``app_worker``) are read-only templates on
  the job's bound org.
- Membership checks run in SECURITY DEFINER helper functions owned by ``app_owner`` (with
  ``search_path`` pinned), so policies never recurse into ``org_memberships``' own policies.
  For those helpers ``app_owner`` gets an explicit read policy on the two tables they read;
  ``app_owner`` is the fully trusted migration role (it can disable RLS anyway, R3.1).
- Ordinary members cannot write memberships at all. Admins may write non-owner rows;
  only owners may create or change owner rows. The very first owner row of a new org may
  be inserted only by the org's creator while the org has no memberships.
- A deferred constraint trigger rejects, at commit, any organization without an active
  owner membership (initial-owner invariant). Role-change/removal locking is M4.
- ``audit_events`` is append-only for runtime roles; reads require owner/admin.
- ``outbox`` gains a nullable ``org_id``; the API role may insert only NULL-org (platform)
  jobs or jobs for the bound org it belongs to. No tenant topics exist yet.
- ``users`` visibility gains the shared-active-membership branch (current org).

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-27
"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql.schema import SchemaItem

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{1,38}$"
HELPERS = (
    "app_is_org_member(uuid)",
    "app_has_org_role(uuid, text[])",
    "app_can_claim_initial_owner(uuid)",
    "app_shares_current_org(uuid)",
)


def _timestamps() -> list[sa.Column[Any]]:
    return [
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    ]


def _config_columns(table: str) -> list[SchemaItem]:
    """Shared shape of the seeded per-org configuration tables."""
    return [
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("name", postgresql.CITEXT(), nullable=False),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name=f"fk_{table}_org_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
        sa.UniqueConstraint("org_id", "id", name=f"uq_{table}_org_id_id"),
        sa.UniqueConstraint("org_id", "name", name=f"uq_{table}_org_id_name"),
    ]


def _create_tables() -> None:
    op.create_table(
        "organizations",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", postgresql.CITEXT(), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=False),
        *_timestamps(),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="ck_organizations_slug_format"),
        sa.CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 100",
            name="ck_organizations_name_valid",
        ),
        sa.ForeignKeyConstraint(
            ["created_by"],
            ["users.id"],
            name="fk_organizations_created_by_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_organizations"),
        sa.UniqueConstraint("slug", name="uq_organizations_slug"),
    )
    op.create_table(
        "org_memberships",
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(16), nullable=False),
        sa.Column(
            "can_create_projects", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        *_timestamps(),
        sa.Column("removed_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "role IN ('owner', 'admin', 'member')", name="ck_org_memberships_role_valid"
        ),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name="fk_org_memberships_org_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_org_memberships_user_id_users", ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("org_id", "user_id", name="pk_org_memberships"),
    )
    op.create_index("ix_org_memberships_user_id_org_id", "org_memberships", ["user_id", "org_id"])
    op.create_table(
        "issue_types",
        *_config_columns("issue_types"),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "kind IN ('epic', 'standard', 'subtask')", name="ck_issue_types_kind_valid"
        ),
    )
    op.create_table(
        "priorities",
        *_config_columns("priorities"),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("color", sa.String(7), nullable=False),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("target_type", sa.String(32), nullable=True),
        sa.Column("target_id", sa.String(64), nullable=True),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(256), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name="fk_audit_events_org_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"],
            ["users.id"],
            name="fk_audit_events_actor_user_id_users",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_events"),
    )
    op.create_index("ix_audit_events_org_id_created_at", "audit_events", ["org_id", "created_at"])
    op.add_column("outbox", sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        "fk_outbox_org_id_organizations",
        "outbox",
        "organizations",
        ["org_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def _create_helpers() -> None:
    # SECURITY DEFINER + pinned search_path; owned by app_owner (the migration role).
    common = "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp"
    op.execute(
        f"""
        CREATE FUNCTION app_is_org_member(org uuid) RETURNS boolean {common} AS $$
          SELECT EXISTS (SELECT 1 FROM org_memberships m
                          WHERE m.org_id = org AND m.user_id = app_current_user()
                            AND m.removed_at IS NULL)
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_has_org_role(org uuid, roles text[]) RETURNS boolean {common} AS $$
          SELECT EXISTS (SELECT 1 FROM org_memberships m
                          WHERE m.org_id = org AND m.user_id = app_current_user()
                            AND m.removed_at IS NULL AND m.role = ANY (roles))
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_can_claim_initial_owner(org uuid) RETURNS boolean {common} AS $$
          SELECT EXISTS (SELECT 1 FROM organizations o
                          WHERE o.id = org AND o.created_by = app_current_user())
             AND NOT EXISTS (SELECT 1 FROM org_memberships m WHERE m.org_id = org)
        $$
        """
    )
    op.execute(
        f"""
        CREATE FUNCTION app_shares_current_org(target uuid) RETURNS boolean {common} AS $$
          SELECT app_is_org_member(app_current_org())
             AND EXISTS (SELECT 1 FROM org_memberships m
                          WHERE m.org_id = app_current_org() AND m.user_id = target
                            AND m.removed_at IS NULL)
        $$
        """
    )
    for helper in HELPERS:
        op.execute(f"REVOKE ALL ON FUNCTION {helper} FROM PUBLIC")
        op.execute(f"GRANT EXECUTE ON FUNCTION {helper} TO {RUNTIME_ROLES}")

    # Initial-owner invariant: checked at COMMIT, independent of the caller's role/RLS.
    op.execute(
        """
        CREATE FUNCTION app_check_org_has_owner() RETURNS trigger
        LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM org_memberships m
                          WHERE m.org_id = NEW.id AND m.role = 'owner'
                            AND m.removed_at IS NULL) THEN
            RAISE EXCEPTION 'organization must have an owner membership'
              USING ERRCODE = 'check_violation', CONSTRAINT = 'org_has_owner';
          END IF;
          RETURN NULL;
        END
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION app_check_org_has_owner() FROM PUBLIC")
    op.execute(
        """
        CREATE CONSTRAINT TRIGGER org_has_owner AFTER INSERT ON organizations
        DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app_check_org_has_owner()
        """
    )


def _create_policies() -> None:
    for table in ("organizations", "org_memberships", "issue_types", "priorities", "audit_events"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    # Read access for the SECURITY DEFINER helpers (owned by app_owner).
    for table in ("organizations", "org_memberships"):
        op.execute(f"CREATE POLICY {table}_helpers ON {table} FOR SELECT TO app_owner USING (true)")

    owner = "ARRAY['owner']"
    managers = "ARRAY['owner', 'admin']"
    # organizations
    op.execute(
        "CREATE POLICY organizations_select ON organizations FOR SELECT TO app_rw "
        "USING (app_is_org_member(id))"
    )
    op.execute(
        "CREATE POLICY organizations_insert ON organizations FOR INSERT TO app_rw "
        "WITH CHECK (id = app_current_org() AND created_by = app_current_user())"
    )
    op.execute(
        "CREATE POLICY organizations_update ON organizations FOR UPDATE TO app_rw "
        f"USING (id = app_current_org() AND app_has_org_role(id, {managers})) "
        "WITH CHECK (id = app_current_org())"
    )
    op.execute(
        "CREATE POLICY organizations_worker ON organizations FOR SELECT TO app_worker "
        "USING (id = app_current_org())"
    )
    # org_memberships: members never write; admins write non-owner rows; owners any row;
    # the creator may insert the first owner row of an org that has no memberships yet.
    write_rule = (
        f"app_has_org_role(org_id, {owner}) "
        f"OR (app_has_org_role(org_id, ARRAY['admin']) AND role <> 'owner')"
    )
    op.execute(
        "CREATE POLICY org_memberships_select ON org_memberships FOR SELECT TO app_rw "
        "USING (user_id = app_current_user() "
        "OR (org_id = app_current_org() AND app_is_org_member(org_id)))"
    )
    op.execute(
        "CREATE POLICY org_memberships_insert ON org_memberships FOR INSERT TO app_rw "
        "WITH CHECK (org_id = app_current_org() AND ("
        "(user_id = app_current_user() AND role = 'owner' "
        "AND app_can_claim_initial_owner(org_id)) "
        f"OR {write_rule}))"
    )
    op.execute(
        "CREATE POLICY org_memberships_update ON org_memberships FOR UPDATE TO app_rw "
        f"USING (org_id = app_current_org() AND ({write_rule})) "
        f"WITH CHECK (org_id = app_current_org() AND ({write_rule}))"
    )
    op.execute(
        "CREATE POLICY org_memberships_worker ON org_memberships FOR SELECT TO app_worker "
        "USING (org_id = app_current_org())"
    )
    # seeded configuration
    for table in ("issue_types", "priorities"):
        op.execute(
            f"CREATE POLICY {table}_select ON {table} FOR SELECT TO app_rw "
            "USING (org_id = app_current_org() AND app_is_org_member(org_id))"
        )
        op.execute(
            f"CREATE POLICY {table}_insert ON {table} FOR INSERT TO app_rw "
            f"WITH CHECK (org_id = app_current_org() AND app_has_org_role(org_id, {managers}))"
        )
    # audit_events: owners/admins read; any active member's action may be recorded.
    op.execute(
        "CREATE POLICY audit_events_select ON audit_events FOR SELECT TO app_rw "
        f"USING (org_id = app_current_org() AND app_has_org_role(org_id, {managers}))"
    )
    op.execute(
        "CREATE POLICY audit_events_insert ON audit_events FOR INSERT TO app_rw "
        "WITH CHECK (org_id = app_current_org() AND app_is_org_member(org_id) "
        "AND (actor_user_id IS NULL OR actor_user_id = app_current_user()))"
    )
    # outbox
    op.execute("ALTER TABLE outbox ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE outbox FORCE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY outbox_api_insert ON outbox FOR INSERT TO app_rw "
        "WITH CHECK (org_id IS NULL "
        "OR (org_id = app_current_org() AND app_is_org_member(org_id)))"
    )
    op.execute(
        "CREATE POLICY outbox_worker ON outbox FOR ALL TO app_worker USING (true) WITH CHECK (true)"
    )
    # users: add the shared-active-membership branch.
    op.execute("DROP POLICY users_select ON users")
    op.execute(
        f"CREATE POLICY users_select ON users FOR SELECT TO {RUNTIME_ROLES} "
        "USING (id = app_current_user() OR email = app_auth_email() "
        "OR app_shares_current_org(id))"
    )


def _grants() -> None:
    tables = ("organizations", "org_memberships", "issue_types", "priorities", "audit_events")
    for table in tables:
        op.execute(f"REVOKE ALL ON {table} FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON organizations TO app_rw")
    op.execute("GRANT UPDATE (name, updated_at) ON organizations TO app_rw")  # slug immutable
    op.execute("GRANT SELECT, INSERT ON org_memberships TO app_rw")
    op.execute("GRANT UPDATE (role, can_create_projects, removed_at) ON org_memberships TO app_rw")
    op.execute("GRANT SELECT, INSERT ON issue_types, priorities TO app_rw")
    op.execute("GRANT SELECT, INSERT ON audit_events TO app_rw")
    op.execute("GRANT USAGE ON SEQUENCE audit_events_id_seq TO app_rw")
    op.execute("REVOKE ALL ON SEQUENCE audit_events_id_seq FROM app_worker")
    # Worker: read-only on organizations/memberships, under RLS and the job's bound org.
    op.execute("GRANT SELECT ON organizations, org_memberships TO app_worker")


def upgrade() -> None:
    _create_tables()
    _create_helpers()
    _create_policies()
    _grants()


def downgrade() -> None:
    op.execute("DROP POLICY users_select ON users")
    op.execute(
        f"CREATE POLICY users_select ON users FOR SELECT TO {RUNTIME_ROLES} "
        "USING (id = app_current_user() OR email = app_auth_email())"
    )
    op.execute("DROP POLICY outbox_api_insert ON outbox")
    op.execute("DROP POLICY outbox_worker ON outbox")
    op.execute("ALTER TABLE outbox NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE outbox DISABLE ROW LEVEL SECURITY")
    op.drop_constraint("fk_outbox_org_id_organizations", "outbox", type_="foreignkey")
    op.drop_column("outbox", "org_id")
    op.drop_index("ix_audit_events_org_id_created_at", table_name="audit_events")
    op.drop_table("audit_events")
    op.drop_table("priorities")
    op.drop_table("issue_types")
    op.drop_index("ix_org_memberships_user_id_org_id", table_name="org_memberships")
    op.drop_table("org_memberships")
    op.drop_table("organizations")  # its trigger goes with it
    op.execute("DROP FUNCTION app_check_org_has_owner()")
    for helper in reversed(HELPERS):
        op.execute(f"DROP FUNCTION {helper}")
