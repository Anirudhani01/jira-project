"""BCP 47 locale validation for organization settings (A5).

Supported scope (v1): general well-formed BCP 47 language tags stored in ``VARCHAR(255)``.
Validation runs at the API layer (A5.2); this module is the single definition of rules.

PATCH semantics (A5.2): request models use optional fields with ``extra="forbid"``.
Omitted fields are not updated; explicit JSON ``null`` is rejected (non-optional types /
validators), distinct from omission.

Display formatting (A5.4, frontend — not implemented here):
- **Timezone-aware date/time**: absolute instants rendered with ``Intl.DateTimeFormat`` and
  the organization's IANA timezone (API timestamps remain UTC).
- **Relative time** (``Intl.RelativeTimeFormat``): calendar distance from "now" (minutes,
  hours, days). Relative buckets are not the same as timezone-shifted wall-clock display;
  A5.4 documents and tests them separately in ``frontend/src/lib/orgFormatting.ts``.
"""

from __future__ import annotations

import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# RFC 5646-style tag: language plus extension / variant / private-use subtags (1-8 alphanum).
_BCP47_TAG = re.compile(
    r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$",
    re.ASCII,
)
_MAX_LOCALE_LEN = 255


class LocaleValidationError(ValueError):
    """Raised when a locale tag is not a supported well-formed BCP 47 tag."""


class TimezoneValidationError(ValueError):
    """Raised when a timezone is not a valid IANA identifier."""


def normalize_bcp47_locale(raw: str) -> str:
    """Validate and normalize a BCP 47 language tag for storage.

    Normalization:
    - Primary language subtag: lowercase (``en``).
    - Two-letter region subtags: uppercase (``US`` → ``en-US``).
    - Four-letter script subtags: title case (``latn`` → ``Latn``).
    - Other registered subtags: lowercase unless already mixed (variant/extensions preserved
      in lowercase alphanumerics per common practice).
    """
    tag = raw.strip()
    if not tag or len(tag) > _MAX_LOCALE_LEN:
        raise LocaleValidationError("locale must be 1-255 characters")
    if "_" in tag:
        raise LocaleValidationError("locale must use BCP 47 hyphen separators, not underscores")
    if not _BCP47_TAG.fullmatch(tag):
        raise LocaleValidationError("locale must be a well-formed BCP 47 language tag")

    parts = tag.split("-")
    language = parts[0].lower()
    if len(language) < 2:
        raise LocaleValidationError("language subtag is too short")

    normalized: list[str] = [language]
    index = 1
    if index < len(parts) and len(parts[index]) == 4 and parts[index].isalpha():
        script = parts[index]
        normalized.append(script[:1].upper() + script[1:].lower())
        index += 1
    if index < len(parts) and len(parts[index]) == 2 and parts[index].isalpha():
        normalized.append(parts[index].upper())
        index += 1
    while index < len(parts):
        normalized.append(parts[index].lower())
        index += 1
    return "-".join(normalized)


def validate_bcp47_locale(raw: str) -> str:
    """Alias for normalize; use at API boundary."""
    return normalize_bcp47_locale(raw)


def validate_iana_timezone(raw: str) -> str:
    """Validate an IANA time zone name for storage (unchanged casing except strip)."""
    value = raw.strip()
    if not value:
        raise TimezoneValidationError("timezone is required")
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise TimezoneValidationError("timezone must be a valid IANA time zone") from exc
    return value
