"""Organization settings (A5.1): per-org timezone and locale.

One row per organization (``org_id`` primary key). Defaults: ``UTC``, ``en-US``.
Backfill existing organizations on upgrade. Runtime roles may not DELETE.

Revision ID: 0019
Revises: 0018
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0019"
down_revision: str | None = "0018"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
RUNTIME_ROLES = "app_rw, app_worker"
MANAGERS = "ARRAY['owner', 'admin']"


def upgrade() -> None:
    op.create_table(
        "organization_settings",
        sa.Column("org_id", UUID, nullable=False),
        sa.Column(
            "timezone",
            sa.String(64),
            server_default=sa.text("'UTC'"),
            nullable=False,
        ),
        sa.Column(
            "locale",
            sa.String(255),
            server_default=sa.text("'en-US'"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("org_id", name="pk_organization_settings"),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name="fk_organization_settings_org_id_organizations",
            ondelete="RESTRICT",
        ),
    )

    op.execute(
        """
        INSERT INTO organization_settings (org_id, timezone, locale)
        SELECT id, 'UTC', 'en-US' FROM organizations
        ON CONFLICT (org_id) DO NOTHING
        """
    )

    op.execute("ALTER TABLE organization_settings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE organization_settings FORCE ROW LEVEL SECURITY")

    op.execute(
        "CREATE POLICY organization_settings_select ON organization_settings FOR SELECT TO app_rw "
        "USING (org_id = app_current_org() AND app_is_org_member(org_id))"
    )
    op.execute(
        "CREATE POLICY organization_settings_insert ON organization_settings FOR INSERT TO app_rw "
        f"WITH CHECK (org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS}))"
    )
    op.execute(
        "CREATE POLICY organization_settings_update ON organization_settings FOR UPDATE TO app_rw "
        f"USING (org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS})) "
        f"WITH CHECK (org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS}))"
    )

    op.execute(f"REVOKE ALL ON organization_settings FROM PUBLIC, {RUNTIME_ROLES}")
    op.execute("GRANT SELECT, INSERT ON organization_settings TO app_rw")
    op.execute("GRANT UPDATE (timezone, locale, updated_at) ON organization_settings TO app_rw")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS organization_settings_update ON organization_settings")
    op.execute("DROP POLICY IF EXISTS organization_settings_insert ON organization_settings")
    op.execute("DROP POLICY IF EXISTS organization_settings_select ON organization_settings")
    op.drop_table("organization_settings")
