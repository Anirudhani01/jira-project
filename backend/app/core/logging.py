"""Structured JSON logging with an allowlist of fields.

Only the fixed envelope fields and the names in ``ALLOWED_EXTRA_FIELDS`` are ever
emitted; anything else passed via ``extra=`` is dropped. Request bodies, headers,
cookies and query strings are never logged by design. ``redact`` is a backstop for
free-text messages and stack traces, not the primary control.
"""

import json
import logging
import re
import sys
from contextvars import ContextVar
from datetime import UTC, datetime
from typing import Any, Final

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

ALLOWED_EXTRA_FIELDS: Final = frozenset(
    {
        "event",
        "method",
        "route",
        "status",
        "duration_ms",
        "error_type",
        "driver_error_type",
        "error_message",
        "component",
        "check",
        "outcome",
        "environment",
        "violations",
        "org_id",
        "user_id",
        "job_id",
        "topic",
        "attempts",
    }
)

_REDACTED = "[REDACTED]"
_REDACTION_PATTERNS: Final = (
    # credentials embedded in URLs: scheme://user:secret@host
    (re.compile(r"(?i)\b([a-z][a-z0-9+.-]*://[^:/\s@]*):[^@\s/]+@"), rf"\1:{_REDACTED}@"),
    # email addresses (e.g. PostgreSQL DETAIL lines such as "Key (email)=(...)")
    (re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"), "[EMAIL]"),
    # bearer tokens
    (re.compile(r"(?i)\bbearer\s+[a-z0-9._~+/-]+=*"), f"Bearer {_REDACTED}"),
    # key=value / key: value pairs with sensitive key names
    (
        re.compile(
            r"(?i)\b([a-z_-]*(?:password|passwd|secret|token|api[_-]?key|authorization|cookie"
            r"|session)[a-z_-]*)(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&]+)"
        ),
        rf"\1\2{_REDACTED}",
    ),
)


def redact(text: str) -> str:
    for pattern, replacement in _REDACTION_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def exception_type_name(exc: BaseException) -> str:
    cls = type(exc)
    return f"{cls.__module__}.{cls.__qualname__}"


def sanitized_error_extra(exc: BaseException) -> dict[str, str]:
    """Structured ``extra=`` fields for an exception without leaking secrets."""
    driver: BaseException = exc
    orig = getattr(exc, "orig", None)
    if isinstance(orig, BaseException):
        driver = orig
    extra: dict[str, str] = {
        "error_type": exception_type_name(exc),
        "error_message": redact(str(exc)),
    }
    if driver is not exc:
        extra["driver_error_type"] = exception_type_name(driver)
    return extra


def _safe_value(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, list | tuple):
        return [_safe_value(item) for item in value]
    return redact(str(value))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, tz=UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        request_id = request_id_var.get()
        if request_id is not None:
            payload["request_id"] = request_id
        for key in ALLOWED_EXTRA_FIELDS:
            if key in record.__dict__:
                payload[key] = _safe_value(record.__dict__[key])
        if record.exc_info:
            payload["exception"] = redact(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: str) -> None:
    """Route all application and server logs through the JSON formatter."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(level)
    for name in ("uvicorn", "uvicorn.error"):
        server_logger = logging.getLogger(name)
        server_logger.handlers.clear()
        server_logger.propagate = True
    # uvicorn's access log includes raw paths with query strings; our middleware
    # emits an allowlisted access record instead.
    access = logging.getLogger("uvicorn.access")
    access.handlers.clear()
    access.propagate = False
    access.disabled = True
