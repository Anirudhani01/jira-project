"""Developer CLI. Usage: ``python -m app.cli users verify <email>``.

Dev/test only (plan V2.3): there is no HTTP bypass for email verification, and this
command refuses to run when ENVIRONMENT is staging or prod. It connects with the
runtime role (DATABASE_URL), so RLS applies, and records a platform security event.
"""

import argparse
import asyncio
import sys

from app.core.config import Settings, get_settings
from app.core.security import normalize_email
from app.db.engine import create_db_engine
from app.db.session import create_sessionmaker
from app.db.tenant import TenantContext, bind_auth_email, bind_tenant
from app.modules.identity import repository
from app.modules.security_events import service as events
from app.modules.security_events.service import ClientInfo

ALLOWED_ENVIRONMENTS = frozenset({"dev", "test"})


class CliError(RuntimeError):
    pass


async def verify_user(settings: Settings, email: str) -> None:
    if settings.environment not in ALLOWED_ENVIRONMENTS:
        raise CliError(f"refusing to run in ENVIRONMENT={settings.environment} (dev/test only)")
    email = normalize_email(email)
    engine = create_db_engine(settings, application_name="jira-cli")
    try:
        sessionmaker = create_sessionmaker(engine)
        async with sessionmaker() as session, session.begin():
            await bind_auth_email(session, email)
            user = await repository.get_user_by_email(session, email)
            if user is None:
                raise CliError("no user with that email")
            await bind_tenant(session, TenantContext(org_id=None, user_id=user.id))
            await repository.mark_email_verified(session, user.id)
            await events.record(
                session,
                "user.verified_by_cli",
                "success",
                ClientInfo(ip=None, user_agent="app.cli"),
                user_id=user.id,
            )
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    groups = parser.add_subparsers(dest="group", required=True)
    users = groups.add_parser("users").add_subparsers(dest="command", required=True)
    verify = users.add_parser("verify", help="mark a user's email as verified (dev/test only)")
    verify.add_argument("email")
    args = parser.parse_args(argv)
    try:
        asyncio.run(verify_user(get_settings(), args.email))
    except CliError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print("verified")
    return 0


if __name__ == "__main__":
    sys.exit(main())
