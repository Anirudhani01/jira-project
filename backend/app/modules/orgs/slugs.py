"""Organization slug rules (plan V2.6): format, reserved names, immutability."""

import re
from typing import Final

SLUG_RE: Final = re.compile(r"^[a-z0-9][a-z0-9-]{1,38}$")

# Exactly the Revision 3 V2.6 list.
RESERVED_SLUGS: Final = frozenset(
    {
        "api", "admin", "app", "auth", "login", "logout", "signup", "o", "orgs", "new",
        "settings", "account", "invitations", "static", "assets", "health", "status",
        "support", "help", "docs", "www",
    }
)  # fmt: skip


def is_well_formed_slug(value: str) -> bool:
    """Slugs are case-insensitive: ``ACME`` resolves to ``acme``."""
    return bool(SLUG_RE.fullmatch(value.lower()))


def is_reserved(slug: str) -> bool:
    return slug.lower() in RESERVED_SLUGS
