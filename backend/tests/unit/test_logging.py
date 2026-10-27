import json
import logging
import sys

import pytest

from app.core.logging import JsonFormatter, redact, request_id_var


def _record(message: str, *args: object, **extra: object) -> logging.LogRecord:
    record = logging.LogRecord("test", logging.INFO, __file__, 1, message, args, None)
    for key, value in extra.items():
        setattr(record, key, value)
    return record


def test_only_allowlisted_extra_fields_are_emitted() -> None:
    record = _record(
        "request completed",
        method="POST",
        route="/things/{id}",
        status=201,
        password="hunter2-password",
        body='{"password": "x"}',
        headers={"cookie": "session=abc"},
        query="token=abc",
    )
    payload = json.loads(JsonFormatter().format(record))
    assert payload["method"] == "POST"
    assert payload["route"] == "/things/{id}"
    assert payload["status"] == 201
    for forbidden in ("password", "body", "headers", "query"):
        assert forbidden not in payload
    assert "hunter2" not in json.dumps(payload)


def test_request_id_is_included_from_context() -> None:
    token = request_id_var.set("req-12345678")
    try:
        payload = json.loads(JsonFormatter().format(_record("hello")))
    finally:
        request_id_var.reset(token)
    assert payload["request_id"] == "req-12345678"


@pytest.mark.parametrize(
    ("text", "secret"),
    [
        ("connect postgresql+asyncpg://app_rw:pa55word@db:5432/jira failed", "pa55word"),
        ("password=hunter2 user=bob", "hunter2"),
        ('new_password: "correct horse"', "correct horse"),
        ("Authorization: Bearer eyJhbGciOi.payload.sig", "eyJhbGciOi"),
        ("cookie=session_abcdef", "session_abcdef"),
        ("reset_token=abc123def", "abc123def"),
    ],
)
def test_redaction_backstop(text: str, secret: str) -> None:
    assert secret not in redact(text)


def test_exception_text_is_redacted() -> None:
    try:
        raise RuntimeError("cannot connect redis://:topsecret@cache:6379/0")
    except RuntimeError:
        record = logging.LogRecord("test", logging.ERROR, __file__, 1, "boom", (), sys.exc_info())
    payload = json.loads(JsonFormatter().format(record))
    assert "topsecret" not in payload["exception"]
    assert "RuntimeError" in payload["exception"]


def test_non_primitive_extra_values_are_stringified_and_redacted() -> None:
    record = _record("x", violations=["superuser", "password=leak"])
    payload = json.loads(JsonFormatter().format(record))
    assert payload["violations"] == ["superuser", "password=[REDACTED]"]
