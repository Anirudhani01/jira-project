"""Saved issue-list filters.

``saved_filters``: one user's named filter set for one project. Composite FKs keep the user
inside the org's memberships and the project inside the org. RLS: every operation is limited
to the bound org and the owning user, so nobody can read or change another user's filters.
Names are unique per user and project, case-insensitively.

Revision ID: 0027
Revises: 0026
Create Date: 2026-11-14
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0027"
down_revision: str | None = "0026"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
OWN = "org_id = app_current_org() AND user_id = app_current_user()"


def upgrade() -> None:
    op.create_table(
        "saved_filters",
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("project_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column(
            "params", postgresql.JSONB, server_default=sa.text("'{}'::jsonb"), nullable=False
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
        sa.PrimaryKeyConstraint("id", name="pk_saved_filters"),
        sa.CheckConstraint(
            "name = btrim(name) AND char_length(name) BETWEEN 1 AND 60",
            name="ck_saved_filters_name_valid",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "user_id"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_saved_filters_org_id_user_id_org_memberships",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "project_id"],
            ["projects.org_id", "projects.id"],
            name="fk_saved_filters_org_id_project_id_projects",
        ),
    )
    op.create_index(
        "uq_saved_filters_project_id_user_id_lower_name",
        "saved_filters",
        ["project_id", "user_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "ix_saved_filters_org_id_project_id_user_id",
        "saved_filters",
        ["org_id", "project_id", "user_id"],
    )
    op.execute("ALTER TABLE saved_filters ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE saved_filters FORCE ROW LEVEL SECURITY")
    for action, clause in (
        ("SELECT", f"USING ({OWN})"),
        ("INSERT", f"WITH CHECK ({OWN})"),
        ("UPDATE", f"USING ({OWN}) WITH CHECK ({OWN})"),
        ("DELETE", f"USING ({OWN})"),
    ):
        op.execute(
            f"CREATE POLICY saved_filters_{action.lower()} ON saved_filters "
            f"FOR {action} TO app_rw {clause}"
        )
    op.execute("REVOKE ALL ON saved_filters FROM PUBLIC, app_rw, app_worker")
    op.execute("GRANT SELECT, INSERT, DELETE ON saved_filters TO app_rw")
    op.execute("GRANT UPDATE (name, params, updated_at) ON saved_filters TO app_rw")


def downgrade() -> None:
    op.drop_table("saved_filters")
