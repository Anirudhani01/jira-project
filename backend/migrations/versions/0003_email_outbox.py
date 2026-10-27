"""Email (M2): user_tokens, outbox, and least-privilege grants for the worker role.

- ``user_tokens``: single-use verification/reset tokens, SHA-256 hashes only. The API role
  may SELECT/UPDATE (to consume atomically); only the worker role may INSERT (it mints
  tokens at send time, so raw tokens never sit in the database or the outbox).
- ``outbox``: the API role may INSERT only; the worker role may SELECT/UPDATE (claim,
  ack, retry, dead-letter). No DELETE for anyone at runtime. TEMPORARY: no ``org_id``/RLS
  until M3 (all M2 jobs are global identity emails); M3 adds both before any tenant job.
- Worker role tightened on M1 tables (plan R3.1): no access to ``user_sessions``,
  read-only on ``users``.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_tokens",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("purpose", sa.String(32), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("invalidated_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "purpose IN ('verify_email', 'reset_password')", name="ck_user_tokens_purpose_valid"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.id"], name="fk_user_tokens_user_id_users", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_tokens"),
        sa.UniqueConstraint("token_hash", name="uq_user_tokens_token_hash"),
    )
    op.create_index(
        "ix_user_tokens_user_id_purpose_active",
        "user_tokens",
        ["user_id", "purpose"],
        postgresql_where=sa.text("used_at IS NULL AND invalidated_at IS NULL"),
    )
    op.execute("REVOKE ALL ON user_tokens FROM app_rw, app_worker")
    op.execute("GRANT SELECT, UPDATE ON user_tokens TO app_rw")
    op.execute("GRANT SELECT, INSERT, UPDATE ON user_tokens TO app_worker")

    op.create_table(
        "outbox",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("topic", sa.String(64), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "available_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_error", sa.String(200), nullable=True),
        sa.Column("processed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dead_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_outbox"),
    )
    op.create_index(
        "ix_outbox_available_at_pending",
        "outbox",
        ["available_at"],
        postgresql_where=sa.text("processed_at IS NULL AND dead_at IS NULL"),
    )
    op.create_index(
        "ix_outbox_dead_at", "outbox", ["dead_at"], postgresql_where=sa.text("dead_at IS NOT NULL")
    )
    op.execute("REVOKE ALL ON outbox FROM app_rw, app_worker")
    op.execute("GRANT INSERT ON outbox TO app_rw")
    op.execute("GRANT USAGE ON SEQUENCE outbox_id_seq TO app_rw")
    op.execute("REVOKE ALL ON SEQUENCE outbox_id_seq FROM app_worker")
    op.execute("GRANT SELECT, UPDATE ON outbox TO app_worker")

    # Least privilege for the worker on M1 tables.
    op.execute("REVOKE ALL ON user_sessions FROM app_worker")
    op.execute("REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON users FROM app_worker")


def downgrade() -> None:
    # Restore the M1 grants (default privileges at the time of migration 0002).
    op.execute("GRANT SELECT, INSERT, UPDATE ON users TO app_worker")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON user_sessions TO app_worker")
    op.drop_index("ix_outbox_dead_at", table_name="outbox")
    op.drop_index("ix_outbox_available_at_pending", table_name="outbox")
    op.drop_table("outbox")
    op.drop_index("ix_user_tokens_user_id_purpose_active", table_name="user_tokens")
    op.drop_table("user_tokens")
