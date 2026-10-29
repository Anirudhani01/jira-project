"""In-app notifications (M11).

``notifications`` (plan R3.3 row 22): composite FKs keep recipient and actor inside the
org's memberships and the issue inside the org. RLS: a recipient reads and updates only
their own rows (``read_at`` is the only updatable column); inserts require the bound org
and that the inserting user is the actor, so a notification can never be forged on someone
else's behalf. ``app_rw`` has no DELETE: the 90-day purge belongs to the M12 retention role.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-30
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0012"
down_revision: str | None = "0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UUID = postgresql.UUID(as_uuid=True)
OWN = "org_id = app_current_org() AND recipient_id = app_current_user()"


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", UUID, server_default=sa.text("gen_random_uuid()"), nullable=False),
        sa.Column("org_id", UUID, nullable=False),
        sa.Column("recipient_id", UUID, nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("issue_id", UUID, nullable=False),
        sa.Column("actor_id", UUID, nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB,
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_notifications"),
        sa.CheckConstraint(
            "type IN ('issue_assigned', 'issue_commented', 'issue_status_changed')",
            name="ck_notifications_type_valid",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "recipient_id"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_notifications_org_id_recipient_id_org_memberships",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "actor_id"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_notifications_org_id_actor_id_org_memberships",
        ),
        sa.ForeignKeyConstraint(
            ["org_id", "issue_id"],
            ["issues.org_id", "issues.id"],
            name="fk_notifications_org_id_issue_id_issues",
        ),
    )
    op.create_index(
        "ix_notifications_org_id_recipient_id_created_at",
        "notifications",
        ["org_id", "recipient_id", sa.text("created_at DESC"), sa.text("id DESC")],
    )
    op.create_index(
        "ix_notifications_org_id_recipient_id_unread",
        "notifications",
        ["org_id", "recipient_id"],
        postgresql_where=sa.text("read_at IS NULL"),
    )
    op.execute("ALTER TABLE notifications ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notifications FORCE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY notifications_select ON notifications FOR SELECT TO app_rw USING ({OWN})"
    )
    op.execute(
        "CREATE POLICY notifications_insert ON notifications FOR INSERT TO app_rw "
        "WITH CHECK (org_id = app_current_org() AND actor_id = app_current_user())"
    )
    op.execute(
        f"CREATE POLICY notifications_update ON notifications FOR UPDATE TO app_rw "
        f"USING ({OWN}) WITH CHECK ({OWN})"
    )
    op.execute("REVOKE ALL ON notifications FROM PUBLIC, app_rw, app_worker")
    op.execute("GRANT SELECT, INSERT ON notifications TO app_rw")
    op.execute("GRANT UPDATE (read_at) ON notifications TO app_rw")


def downgrade() -> None:
    op.drop_table("notifications")
