"""Organization authentication activity projection (A3.2).

Projects selected ``security.platform_security_events`` rows into
``public.org_authentication_events`` for org owner/admin read paths. Platform events
remain INSERT-only for runtime roles; projection inserts run as ``app_owner`` SECURITY
DEFINER functions. Fail-open trigger; gap-based reconciliation; operator-only retry of
permanent failures; operator-visible missing-source inconsistencies inside retention.

Revision ID: 0018
Revises: 0017
Create Date: 2026-11-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0018"
down_revision: str | None = "0017"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

RUNTIME_ROLES = "app_rw, app_worker"
MANAGERS = "ARRAY['owner', 'admin']"
ORG_AUTH_OPERATOR = "org_auth_operator"
DEFINER = "LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, security, pg_temp"
HELPER = "LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp"


def upgrade() -> None:
    op.execute(
        f"""
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{ORG_AUTH_OPERATOR}') THEN
            RAISE EXCEPTION 'role {ORG_AUTH_OPERATOR} is missing: re-run '
              'infra/postgres/init/01-roles.sh or provision it in your IaC';
          END IF;
        END $$
        """
    )

    op.create_table(
        "org_authentication_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform_event_id", sa.BigInteger(), nullable=False),
        sa.Column("event_type", sa.String(64), nullable=False),
        sa.Column("outcome", sa.String(16), nullable=False),
        sa.Column("reason", sa.String(64), nullable=True),
        sa.Column(
            "metadata",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("member_display_name", sa.Text(), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["org_id"],
            ["organizations.id"],
            name="fk_org_auth_events_org_id_organizations",
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_org_authentication_events"),
        sa.UniqueConstraint("platform_event_id", "org_id", name="uq_org_auth_events_platform_org"),
    )
    op.create_index(
        "ix_org_auth_events_org_occurred_id",
        "org_authentication_events",
        ["org_id", "occurred_at", "id"],
    )
    op.create_index(
        "ix_org_auth_events_org_user_occurred",
        "org_authentication_events",
        ["org_id", "user_id", "occurred_at"],
    )

    op.create_table(
        "org_auth_projection_failures",
        sa.Column("platform_event_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "first_failed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "last_failed_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column(
            "next_retry_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("permanent", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("sqlstate", sa.String(5), nullable=True),
        sa.Column("message", sa.String(512), nullable=True),
        sa.PrimaryKeyConstraint("platform_event_id", name="pk_org_auth_projection_failures"),
        schema="security",
    )

    op.create_table(
        "org_auth_operator_actions",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("platform_event_id", sa.BigInteger(), nullable=False),
        sa.Column("operator", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_org_auth_operator_actions"),
        schema="security",
    )
    op.create_index(
        "ix_org_auth_operator_actions_platform_event_id",
        "org_auth_operator_actions",
        ["platform_event_id"],
        schema="security",
    )

    op.create_table(
        "org_auth_missing_source_inconsistencies",
        sa.Column("id", sa.BigInteger(), sa.Identity(always=True), nullable=False),
        sa.Column("projection_id", sa.BigInteger(), nullable=False),
        sa.Column("platform_event_id", sa.BigInteger(), nullable=False),
        sa.Column("org_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("occurred_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "detected_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_org_auth_missing_source_inconsistencies"),
        sa.UniqueConstraint("projection_id", name="uq_org_auth_missing_source_projection_id"),
        schema="security",
    )

    op.execute(
        f"""
        CREATE FUNCTION app_user_was_org_member_at(org uuid, uid uuid, at timestamptz)
        RETURNS boolean
        {HELPER} AS $$
          SELECT EXISTS (
            SELECT 1 FROM org_memberships m
             WHERE m.org_id = org AND m.user_id = uid
               AND m.created_at <= at
               AND (m.removed_at IS NULL OR m.removed_at > at)
          )
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION app_user_was_org_member_at(uuid, uuid, timestamptz) FROM PUBLIC"
    )

    op.execute(
        f"""
        CREATE FUNCTION security.apply_org_auth_projection(p_event_id bigint)
        RETURNS void
        {DEFINER} AS $$
        DECLARE
          ev security.platform_security_events%ROWTYPE;
          v_name text;
        BEGIN
          SELECT * INTO ev FROM security.platform_security_events WHERE id = p_event_id;
          IF NOT FOUND THEN
            RETURN;
          END IF;
          IF ev.user_id IS NULL THEN
            RETURN;
          END IF;
          IF ev.event_type NOT IN (
            'auth.login.succeeded',
            'auth.login.failed',
            'auth.logout',
            'auth.password.changed',
            'auth.password_reset.requested',
            'auth.password.reset',
            'auth.session.revoked',
            'auth.rate_limited'
          ) THEN
            RETURN;
          END IF;

          SELECT u.display_name INTO v_name FROM users u WHERE u.id = ev.user_id;
          IF v_name IS NULL THEN
            v_name := 'Unknown user';
          END IF;

          INSERT INTO org_authentication_events (
            org_id, user_id, platform_event_id, event_type, outcome, reason,
            metadata, member_display_name, occurred_at
          )
          SELECT
            m.org_id, ev.user_id, ev.id, ev.event_type, ev.outcome, ev.reason,
            ev.metadata, v_name, ev.occurred_at
          FROM org_memberships m
          WHERE m.user_id = ev.user_id
            AND app_user_was_org_member_at(m.org_id, ev.user_id, ev.occurred_at)
          ON CONFLICT (platform_event_id, org_id) DO NOTHING;

          DELETE FROM security.org_auth_projection_failures WHERE platform_event_id = p_event_id;
        END;
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION security.apply_org_auth_projection(bigint) FROM PUBLIC")

    op.execute(
        f"""
        CREATE FUNCTION security.record_org_auth_projection_failure(
          p_platform_event_id bigint,
          p_sqlstate text,
          p_message text
        )
        RETURNS void
        {DEFINER} AS $$
        DECLARE
          v_attempt int;
          v_delay_minutes numeric;
        BEGIN
          INSERT INTO security.org_auth_projection_failures (
            platform_event_id, first_failed_at, last_failed_at, attempt_count,
            next_retry_at, permanent, sqlstate, message
          ) VALUES (
            p_platform_event_id, now(), now(), 1, now() + interval '2 minutes', false,
            left(p_sqlstate, 5), left(p_message, 512)
          )
          ON CONFLICT (platform_event_id) DO UPDATE SET
            last_failed_at = now(),
            attempt_count = security.org_auth_projection_failures.attempt_count + 1,
            sqlstate = EXCLUDED.sqlstate,
            message = EXCLUDED.message,
            permanent = (security.org_auth_projection_failures.attempt_count + 1 >= 5),
            next_retry_at = now() + (
              LEAST(60, power(2, security.org_auth_projection_failures.attempt_count + 1))
              * interval '1 minute'
            );
        END;
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION security.record_org_auth_projection_failure("
        "bigint, text, text) FROM PUBLIC"
    )

    op.execute(
        f"""
        CREATE FUNCTION security.trg_org_auth_after_platform_insert()
        RETURNS trigger
        {DEFINER} AS $$
        BEGIN
          IF TG_OP IS DISTINCT FROM 'INSERT'
             OR TG_TABLE_SCHEMA IS DISTINCT FROM 'security'
             OR TG_TABLE_NAME IS DISTINCT FROM 'platform_security_events' THEN
            RAISE EXCEPTION 'invalid trigger invocation';
          END IF;
          BEGIN
            PERFORM security.apply_org_auth_projection(NEW.id);
          EXCEPTION
            WHEN OTHERS THEN
              BEGIN
                PERFORM security.record_org_auth_projection_failure(
                  NEW.id, SQLSTATE, SQLERRM
                );
              EXCEPTION
                WHEN OTHERS THEN
                  RAISE LOG
                    'org_auth_projection.failure_persist_failed platform_event_id=% sqlstate=%',
                    NEW.id, SQLSTATE;
              END;
          END;
          RETURN NEW;
        END;
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION security.trg_org_auth_after_platform_insert() FROM PUBLIC")

    op.execute(
        f"""
        CREATE FUNCTION security.detect_org_auth_missing_sources()
        RETURNS int
        {DEFINER} AS $$
        DECLARE
          v_count int := 0;
        BEGIN
          INSERT INTO security.org_auth_missing_source_inconsistencies (
            projection_id, platform_event_id, org_id, occurred_at
          )
          SELECT o.id, o.platform_event_id, o.org_id, o.occurred_at
          FROM org_authentication_events o
          LEFT JOIN security.platform_security_events p ON p.id = o.platform_event_id
          WHERE p.id IS NULL
            AND o.occurred_at > now() - interval '1 year'
          ON CONFLICT (projection_id) DO NOTHING;
          GET DIAGNOSTICS v_count = ROW_COUNT;
          IF v_count > 0 THEN
            RAISE LOG 'org_auth_projection.missing_source_inconsistencies count=%', v_count;
          END IF;
          RETURN v_count;
        END;
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION security.detect_org_auth_missing_sources() FROM PUBLIC")

    op.execute(
        f"""
        CREATE FUNCTION security.reconcile_org_auth_projections(p_limit int)
        RETURNS int
        {DEFINER} AS $$
        -- Cold fairness: each invocation reserves v_cold_cap slots (>=1, <=20) for events
        -- older than 7 days before filling hot gaps, so continuous hot traffic cannot
        -- permanently starve cold backlog (Phase 3 test: hot flood + cold backlog > batch).
        DECLARE
          v_cold_cap int;
          v_hot_cap int;
          v_total int := 0;
          r record;
        BEGIN
          IF p_limit < 1 THEN
            RETURN 0;
          END IF;
          v_cold_cap := GREATEST(1, LEAST(p_limit / 5, 20));
          v_hot_cap := GREATEST(0, p_limit - v_cold_cap);

          FOR r IN
            SELECT p.id
            FROM security.platform_security_events p
            WHERE p.user_id IS NOT NULL
              AND p.event_type IN (
                'auth.login.succeeded', 'auth.login.failed', 'auth.logout',
                'auth.password.changed', 'auth.password_reset.requested',
                'auth.password.reset', 'auth.session.revoked', 'auth.rate_limited'
              )
              AND p.occurred_at >= now() - interval '365 days'
              AND p.occurred_at < now() - interval '7 days'
              AND EXISTS (
                SELECT 1 FROM org_memberships m
                WHERE m.user_id = p.user_id
                  AND app_user_was_org_member_at(m.org_id, p.user_id, p.occurred_at)
                  AND NOT EXISTS (
                    SELECT 1 FROM org_authentication_events o
                    WHERE o.platform_event_id = p.id AND o.org_id = m.org_id
                  )
              )
              AND NOT EXISTS (
                SELECT 1 FROM security.org_auth_projection_failures f
                WHERE f.platform_event_id = p.id AND f.permanent
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM security.org_auth_projection_failures f
                  WHERE f.platform_event_id = p.id
                )
                OR EXISTS (
                  SELECT 1 FROM security.org_auth_projection_failures f
                  WHERE f.platform_event_id = p.id
                    AND NOT f.permanent
                    AND f.attempt_count < 5
                    AND f.next_retry_at <= now()
                )
              )
            ORDER BY p.occurred_at ASC
            LIMIT v_cold_cap
          LOOP
            PERFORM security.apply_org_auth_projection(r.id);
            v_total := v_total + 1;
          END LOOP;

          FOR r IN
            SELECT p.id
            FROM security.platform_security_events p
            WHERE p.user_id IS NOT NULL
              AND p.event_type IN (
                'auth.login.succeeded', 'auth.login.failed', 'auth.logout',
                'auth.password.changed', 'auth.password_reset.requested',
                'auth.password.reset', 'auth.session.revoked', 'auth.rate_limited'
              )
              AND p.occurred_at >= now() - interval '365 days'
              AND EXISTS (
                SELECT 1 FROM org_memberships m
                WHERE m.user_id = p.user_id
                  AND app_user_was_org_member_at(m.org_id, p.user_id, p.occurred_at)
                  AND NOT EXISTS (
                    SELECT 1 FROM org_authentication_events o
                    WHERE o.platform_event_id = p.id AND o.org_id = m.org_id
                  )
              )
              AND NOT EXISTS (
                SELECT 1 FROM security.org_auth_projection_failures f
                WHERE f.platform_event_id = p.id AND f.permanent
              )
              AND (
                NOT EXISTS (
                  SELECT 1 FROM security.org_auth_projection_failures f
                  WHERE f.platform_event_id = p.id
                )
                OR EXISTS (
                  SELECT 1 FROM security.org_auth_projection_failures f
                  WHERE f.platform_event_id = p.id
                    AND NOT f.permanent
                    AND f.attempt_count < 5
                    AND f.next_retry_at <= now()
                )
              )
            ORDER BY
              CASE WHEN p.occurred_at >= now() - interval '7 days' THEN 0 ELSE 1 END,
              p.occurred_at ASC
            LIMIT v_hot_cap
          LOOP
            PERFORM security.apply_org_auth_projection(r.id);
            v_total := v_total + 1;
          END LOOP;

          PERFORM security.detect_org_auth_missing_sources();
          RETURN v_total;
        END;
        $$
        """
    )
    op.execute("REVOKE ALL ON FUNCTION security.reconcile_org_auth_projections(int) FROM PUBLIC")
    op.execute(
        "GRANT EXECUTE ON FUNCTION security.reconcile_org_auth_projections(int) TO app_worker"
    )

    op.execute(
        f"""
        CREATE FUNCTION security.operator_reset_org_auth_projection_failure(
          p_platform_event_id bigint,
          p_reason text
        )
        RETURNS void
        {DEFINER} AS $$
        BEGIN
          IF session_user::text IN ('app_rw', 'app_worker', 'app_retention') THEN
            RAISE EXCEPTION 'permission denied for operator reset'
              USING ERRCODE = '42501';
          END IF;
          IF NOT pg_has_role(session_user, '{ORG_AUTH_OPERATOR}', 'MEMBER') THEN
            RAISE EXCEPTION 'permission denied for operator reset'
              USING ERRCODE = '42501';
          END IF;
          IF coalesce(nullif(current_setting('role', true), ''), 'none')
             <> '{ORG_AUTH_OPERATOR}' THEN
            RAISE EXCEPTION 'SET ROLE org_auth_operator is required for operator reset'
              USING ERRCODE = '42501';
          END IF;
          IF p_reason IS NULL OR btrim(p_reason) = '' THEN
            RAISE EXCEPTION 'operator reason is required';
          END IF;
          IF NOT EXISTS (
            SELECT 1 FROM security.org_auth_projection_failures f
            WHERE f.platform_event_id = p_platform_event_id AND f.permanent
          ) THEN
            RAISE EXCEPTION 'no permanent failure exists for platform event %',
              p_platform_event_id;
          END IF;
          UPDATE security.org_auth_projection_failures
             SET permanent = false,
                 attempt_count = 0,
                 next_retry_at = now(),
                 last_failed_at = now()
           WHERE platform_event_id = p_platform_event_id;
          INSERT INTO security.org_auth_operator_actions (
            platform_event_id, operator, reason
          ) VALUES (
            p_platform_event_id, session_user::text, btrim(p_reason)
          );
        END;
        $$
        """
    )
    op.execute(
        "REVOKE ALL ON FUNCTION security.operator_reset_org_auth_projection_failure("
        "bigint, text) FROM PUBLIC"
    )
    op.execute(
        "GRANT EXECUTE ON FUNCTION security.operator_reset_org_auth_projection_failure("
        f"bigint, text) TO {ORG_AUTH_OPERATOR}"
    )
    op.execute(f"GRANT USAGE ON SCHEMA security TO {ORG_AUTH_OPERATOR}")

    op.execute(
        """
        CREATE TRIGGER org_auth_project_platform_event
        AFTER INSERT ON security.platform_security_events
        FOR EACH ROW EXECUTE FUNCTION security.trg_org_auth_after_platform_insert()
        """
    )

    op.execute("ALTER TABLE org_authentication_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE org_authentication_events FORCE ROW LEVEL SECURITY")
    op.execute(
        f"""
        CREATE POLICY org_auth_events_select ON org_authentication_events
        FOR SELECT TO app_rw
        USING (org_id = app_current_org() AND app_has_org_role(org_id, {MANAGERS}))
        """
    )
    op.execute(
        """
        CREATE POLICY org_auth_events_insert ON org_authentication_events
        FOR INSERT TO app_owner
        WITH CHECK (app_user_was_org_member_at(org_id, user_id, occurred_at))
        """
    )
    op.execute(
        """
        CREATE POLICY org_auth_events_definer_select ON org_authentication_events
        FOR SELECT TO app_owner
        USING (true)
        """
    )

    op.execute("REVOKE ALL ON org_authentication_events FROM PUBLIC, app_rw, app_worker")
    op.execute("GRANT SELECT ON org_authentication_events TO app_rw")
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON org_authentication_events TO app_owner")

    op.execute(
        "REVOKE ALL ON security.org_auth_projection_failures FROM PUBLIC, app_rw, app_worker"
    )
    op.execute(f"GRANT SELECT ON security.org_auth_projection_failures TO {ORG_AUTH_OPERATOR}")
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON security.org_auth_projection_failures TO app_owner"
    )

    op.execute("REVOKE ALL ON security.org_auth_operator_actions FROM PUBLIC, app_rw, app_worker")
    op.execute(f"GRANT SELECT ON security.org_auth_operator_actions TO {ORG_AUTH_OPERATOR}")
    op.execute("GRANT SELECT, INSERT ON security.org_auth_operator_actions TO app_owner")

    op.execute(
        "REVOKE ALL ON security.org_auth_missing_source_inconsistencies "
        "FROM PUBLIC, app_rw, app_worker"
    )
    op.execute(
        f"GRANT SELECT ON security.org_auth_missing_source_inconsistencies TO {ORG_AUTH_OPERATOR}"
    )
    op.execute(
        "GRANT SELECT, INSERT ON security.org_auth_missing_source_inconsistencies TO app_owner"
    )

    op.execute("GRANT SELECT ON security.platform_security_events TO app_owner")

    op.execute("DROP POLICY IF EXISTS users_helpers ON users")
    op.execute(
        """
        CREATE POLICY users_org_auth_snapshot ON users FOR SELECT TO app_owner
        USING (
          EXISTS (
            SELECT 1 FROM security.platform_security_events e
            WHERE e.user_id = users.id
          )
        )
        """
    )

    op.execute("GRANT USAGE ON SEQUENCE security.org_auth_operator_actions_id_seq TO app_owner")
    op.execute(
        "GRANT USAGE ON SEQUENCE security.org_auth_missing_source_inconsistencies_id_seq "
        "TO app_owner"
    )
    op.execute("GRANT USAGE ON SEQUENCE org_authentication_events_id_seq TO app_owner")

    op.execute(
        "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_retention') "
        "THEN RAISE EXCEPTION 'role app_retention is missing'; END IF; END $$"
    )
    op.execute("GRANT SELECT, DELETE ON org_authentication_events TO app_retention")
    op.execute(
        "CREATE POLICY org_auth_events_retention_select ON org_authentication_events "
        "FOR SELECT TO app_retention "
        "USING (occurred_at < now() - interval '1 year')"
    )
    op.execute(
        "CREATE POLICY org_auth_events_retention_delete ON org_authentication_events "
        "FOR DELETE TO app_retention "
        "USING (occurred_at < now() - interval '1 year')"
    )
    op.execute("GRANT SELECT, DELETE ON security.org_auth_projection_failures TO app_retention")
    op.execute(
        "CREATE POLICY org_auth_failures_retention_delete ON security.org_auth_projection_failures "
        "FOR DELETE TO app_retention "
        "USING (last_failed_at < now() - interval '90 days')"
    )
    op.execute("GRANT SELECT, DELETE ON security.org_auth_operator_actions TO app_retention")
    op.execute(
        "CREATE POLICY org_auth_operator_actions_retention_delete "
        "ON security.org_auth_operator_actions FOR DELETE TO app_retention "
        "USING (created_at < now() - interval '1 year')"
    )
    op.execute(
        "GRANT SELECT, DELETE ON security.org_auth_missing_source_inconsistencies TO app_retention"
    )
    op.execute(
        "CREATE POLICY org_auth_missing_source_retention_delete "
        "ON security.org_auth_missing_source_inconsistencies FOR DELETE TO app_retention "
        "USING (detected_at < now() - interval '1 year')"
    )


def downgrade() -> None:
    for policy, table in (
        (
            "org_auth_missing_source_retention_delete",
            "security.org_auth_missing_source_inconsistencies",
        ),
        ("org_auth_operator_actions_retention_delete", "security.org_auth_operator_actions"),
        ("org_auth_failures_retention_delete", "security.org_auth_projection_failures"),
        ("org_auth_events_retention_delete", "org_authentication_events"),
        ("org_auth_events_retention_select", "org_authentication_events"),
    ):
        op.execute(f"DROP POLICY IF EXISTS {policy} ON {table}")

    op.execute("REVOKE ALL ON org_authentication_events FROM app_retention")
    op.execute("REVOKE ALL ON security.org_auth_projection_failures FROM app_retention")
    op.execute("REVOKE ALL ON security.org_auth_operator_actions FROM app_retention")
    op.execute("REVOKE ALL ON security.org_auth_missing_source_inconsistencies FROM app_retention")
    op.execute(
        "REVOKE USAGE ON SEQUENCE org_authentication_events_id_seq FROM app_owner, app_retention"
    )
    op.execute(
        "REVOKE USAGE ON SEQUENCE security.org_auth_operator_actions_id_seq "
        "FROM app_owner, app_retention"
    )
    op.execute(
        "REVOKE USAGE ON SEQUENCE security.org_auth_missing_source_inconsistencies_id_seq "
        "FROM app_owner, app_retention"
    )

    op.execute(
        "REVOKE EXECUTE ON FUNCTION security.reconcile_org_auth_projections(int) FROM app_worker"
    )
    op.execute(
        "REVOKE EXECUTE ON FUNCTION security.operator_reset_org_auth_projection_failure("
        "bigint, text) FROM org_auth_operator"
    )
    op.execute("REVOKE USAGE ON SCHEMA security FROM org_auth_operator")
    op.execute("REVOKE SELECT ON security.platform_security_events FROM app_owner")
    op.execute("DROP POLICY IF EXISTS users_org_auth_snapshot ON users")
    op.execute("CREATE POLICY users_helpers ON users FOR SELECT TO app_owner USING (true)")

    op.execute(
        "DROP TRIGGER IF EXISTS org_auth_project_platform_event "
        "ON security.platform_security_events"
    )

    op.execute("DROP POLICY IF EXISTS org_auth_events_definer_select ON org_authentication_events")
    op.execute("DROP POLICY IF EXISTS org_auth_events_insert ON org_authentication_events")
    op.execute("DROP POLICY IF EXISTS org_auth_events_select ON org_authentication_events")

    for fn in (
        "security.operator_reset_org_auth_projection_failure(bigint, text)",
        "security.reconcile_org_auth_projections(int)",
        "security.detect_org_auth_missing_sources()",
        "security.trg_org_auth_after_platform_insert()",
        "security.record_org_auth_projection_failure(bigint, text, text)",
        "security.apply_org_auth_projection(bigint)",
        "app_user_was_org_member_at(uuid, uuid, timestamptz)",
    ):
        op.execute(f"DROP FUNCTION IF EXISTS {fn}")

    op.drop_index(
        "ix_org_auth_operator_actions_platform_event_id",
        table_name="org_auth_operator_actions",
        schema="security",
    )
    op.drop_table("org_auth_missing_source_inconsistencies", schema="security")
    op.drop_table("org_auth_operator_actions", schema="security")
    op.drop_table("org_auth_projection_failures", schema="security")
    op.drop_index("ix_org_auth_events_org_user_occurred", table_name="org_authentication_events")
    op.drop_index("ix_org_auth_events_org_occurred_id", table_name="org_authentication_events")
    op.drop_table("org_authentication_events")
