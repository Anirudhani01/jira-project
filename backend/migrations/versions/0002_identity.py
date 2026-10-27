"""Identity (M1): users, user_sessions, security.platform_security_events.

- ``users``: global table with FORCED row-level security. Runtime roles see a row only
  when it is the bound user (``app_current_user()``) or matches the bound auth-lookup
  email (``app_auth_email()``, used by signup/login). The org-membership visibility
  branch arrives with org_memberships in M3. No DELETE (users are disabled, not deleted).
- ``user_sessions``: no RLS; accessed only by the identity repository by token hash or
  the authenticated user's id. Stores SHA-256 token hashes only.
- ``security.platform_security_events``: separate schema with no default grants. Runtime
  roles may INSERT only; ``platform_security_reader`` (provisioned outside migrations,
  NOLOGIN) may SELECT.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"
SECURITY_READER = "platform_security_reader"


def upgrade() -> None:
    op.execute(
        """
        CREATE FUNCTION app_auth_email() RETURNS citext
        LANGUAGE sql STABLE PARALLEL SAFE
        AS $$ SELECT NULLIF(current_setting('app.auth_email', true), '')::citext $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION app_auth_email() FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION app_auth_email() TO {RUNTIME_ROLES}")

    op.create_table(
        "users",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), server_default=sa.text("'active'"), nullable=False),
        sa.Column("email_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "password_changed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
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
        sa.CheckConstraint("status IN ('active', 'disabled')", name="ck_users_status_valid"),
        sa.CheckConstraint(
            "char_length(display_name) BETWEEN 1 AND 100", name="ck_users_display_name_len"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.execute("ALTER TABLE users ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE users FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY users_select ON users FOR SELECT TO {RUNTIME_ROLES}
        USING (id = app_current_user() OR email = app_auth_email())
        """
    )
    op.execute(
        """
        CREATE POLICY users_insert ON users FOR INSERT TO app_rw
        WITH CHECK (email = app_auth_email())
        """
    )
    op.execute(
        f"""
        CREATE POLICY users_update ON users FOR UPDATE TO {RUNTIME_ROLES}
        USING (id = app_current_user()) WITH CHECK (id = app_current_user())
        """
    )
    op.execute(f"REVOKE DELETE, TRUNCATE ON users FROM {RUNTIME_ROLES}")

    op.create_table(
        "user_sessions",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoke_reason", sa.String(32), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(256), nullable=True),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_user_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user_sessions"),
        sa.UniqueConstraint("token_hash", name="uq_user_sessions_token_hash"),
    )
    op.create_index(
        "ix_user_sessions_user_id_active",
        "user_sessions",
        ["user_id"],
        postgresql_where=sa.text("revoked_at IS NULL"),
    )
    op.execute(f"REVOKE TRUNCATE ON user_sessions FROM {RUNTIME_ROLES}")

    op.execute("CREATE SCHEMA security")
    op.execute("REVOKE ALL ON SCHEMA security FROM PUBLIC")
    op.execute(f"GRANT USAGE ON SCHEMA security TO {RUNTIME_ROLES}, {SECURITY_READER}")
    op.create_table(
        "platform_security_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column(
            "occurred_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("email_hmac", sa.String(64), nullable=True),
        sa.Column("ip", postgresql.INET(), nullable=True),
        sa.Column("user_agent", sa.String(256), nullable=True),
        sa.Column("request_id", sa.String(128), nullable=True),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_platform_security_events"),
        schema="security",
    )
    op.create_index(
        "ix_platform_security_events_occurred_at",
        "platform_security_events",
        ["occurred_at"],
        schema="security",
    )
    op.create_index(
        "ix_platform_security_events_user_id_occurred_at",
        "platform_security_events",
        ["user_id", "occurred_at"],
        schema="security",
    )
    op.execute("REVOKE ALL ON security.platform_security_events FROM PUBLIC")
    op.execute(f"GRANT INSERT ON security.platform_security_events TO {RUNTIME_ROLES}")
    # Inserting into an identity column needs USAGE on its backing sequence (not SELECT).
    op.execute(
        f"GRANT USAGE ON SEQUENCE security.platform_security_events_id_seq TO {RUNTIME_ROLES}"
    )
    op.execute(f"GRANT SELECT ON security.platform_security_events TO {SECURITY_READER}")


def downgrade() -> None:
    op.drop_table("platform_security_events", schema="security")
    op.execute("DROP SCHEMA security")
    op.drop_index("ix_user_sessions_user_id_active", table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_table("users")  # policies are dropped with the table
    op.execute("DROP FUNCTION app_auth_email()")
