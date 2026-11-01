"""Shared constants for org authentication activity reads."""

from typing import Final

# Must match projection / reconcile allowlist in migration 0018.
PROJECTABLE_EVENT_TYPES: Final[frozenset[str]] = frozenset(
    {
        "auth.login.succeeded",
        "auth.login.failed",
        "auth.logout",
        "auth.password.changed",
        "auth.password_reset.requested",
        "auth.password.reset",
        "auth.session.revoked",
        "auth.rate_limited",
    }
)
