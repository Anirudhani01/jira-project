"""M2 units: message construction, delivery guard, outbox payload allowlist."""

import smtplib
import uuid
from email.message import EmailMessage
from pathlib import Path
from typing import ClassVar

import pytest

from app.core.config import Settings
from app.core.mailer import EmailDeliveryDisabledError, OutgoingEmail, SmtpMailer, build_message
from app.modules.identity.emails import EMAIL_TOPICS
from app.modules.outbox.service import TOPIC_PAYLOAD_KEYS, _validate
from tests.conftest import make_settings

EMAIL = OutgoingEmail(
    to="person@example.com", subject="Hello", body="Body\n", idempotency_key="outbox-42"
)


def test_message_has_stable_message_id_per_job_and_plain_text_body() -> None:
    message = build_message(EMAIL, "no-reply@jira.test")
    assert message["Message-ID"] == "<outbox-42@jira.test>"
    assert message["From"] == "no-reply@jira.test"
    assert message.get_content_type() == "text/plain"
    assert build_message(EMAIL, "no-reply@jira.test")["Message-ID"] == message["Message-ID"]


@pytest.mark.parametrize("field", ["to", "subject"])
def test_header_injection_is_rejected(field: str) -> None:
    values = {"to": EMAIL.to, "subject": EMAIL.subject, field: "x\r\nBcc: attacker@example.com"}
    with pytest.raises(ValueError, match=r"linefeed|carriage"):
        build_message(
            OutgoingEmail(body="b", idempotency_key="outbox-1", **values), "no-reply@jira.test"
        )


async def test_mailer_refuses_to_send_while_delivery_is_disabled() -> None:
    with pytest.raises(EmailDeliveryDisabledError):
        await SmtpMailer(make_settings()).send(EMAIL)


def test_every_email_topic_has_an_identifier_only_payload_schema() -> None:
    assert set(TOPIC_PAYLOAD_KEYS) == EMAIL_TOPICS
    assert all(keys == {"user_id"} for keys in TOPIC_PAYLOAD_KEYS.values())


@pytest.mark.parametrize(
    ("topic", "payload"),
    [
        ("email.verify", {"user_id": "Velvet-Harbor-Lantern-93"}),  # gitleaks:allow
        ("email.verify", {"user_id": str(uuid.uuid4()), "token": "abc"}),
        ("email.verify", {}),
        ("other.topic", {"user_id": None}),
    ],
)
def test_payload_validation_rejects_anything_but_ids(
    topic: str, payload: dict[str, str | None]
) -> None:
    with pytest.raises(ValueError, match=r"topic|payload"):
        _validate(topic, payload)


def test_payload_validation_accepts_uuid_or_null() -> None:
    _validate("email.verify", {"user_id": str(uuid.uuid4())})
    _validate("email.password_reset", {"user_id": None})


# ------------------------------------------------------------ M2 review regressions
class FakeSmtp:
    instances: ClassVar[list["FakeSmtp"]] = []

    def __init__(self, *args: object, **kwargs: object) -> None:
        self.sent: list[EmailMessage] = []
        self.closed = False
        FakeSmtp.instances.append(self)

    def starttls(self, **kwargs: object) -> None: ...

    def login(self, user: str, password: str) -> None: ...

    def send_message(self, message: EmailMessage) -> None:
        self.sent.append(message)

    def quit(self) -> None:
        raise smtplib.SMTPServerDisconnected("connection dropped after acceptance")

    def close(self) -> None:
        self.closed = True


async def test_message_accepted_before_a_failing_quit_counts_as_sent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Regression: a QUIT failure after acceptance raised, so the job retried and the
    delivered link was invalidated."""
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)
    settings = make_settings(
        email_delivery_enabled=True, email_from="no-reply@jira.test", smtp_host="smtp.test"
    )
    await SmtpMailer(settings).send(EMAIL)
    smtp = FakeSmtp.instances[-1]
    assert len(smtp.sent) == 1
    assert smtp.closed


ROOT = Path(__file__).resolve().parents[3]


def _env_example() -> dict[str, str]:
    values = {}
    for line in (ROOT / ".env.example").read_text().splitlines():
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key.lower()] = value
    return values


def test_env_example_enables_local_mailpit_delivery_for_dev_only() -> None:
    env = _env_example()
    fields = {k: v for k, v in env.items() if k in Settings.model_fields}
    dev = Settings(**fields)  # type: ignore[arg-type]
    assert dev.environment == "dev"
    assert dev.email_delivery_enabled
    assert dev.smtp_host == "localhost"
    assert dev.smtp_security == "none"
    for environment in ("staging", "prod"):
        with pytest.raises(ValueError, match="SMTP_SECURITY must be starttls or tls"):
            Settings(**{**fields, "environment": environment})  # type: ignore[arg-type]


def test_application_default_keeps_email_delivery_off() -> None:
    assert Settings.model_fields["email_delivery_enabled"].default is False


def test_outbox_carries_no_tenant_jobs_until_m3() -> None:
    """The M2 outbox has no org_id (deferred to M3, plan R3.2). That is only safe while
    every topic is a global identity job keyed by user. A tenant topic must not be added
    before the outbox gains org_id and its RLS policies."""
    assert all(topic.startswith("email.") for topic in TOPIC_PAYLOAD_KEYS)
    assert all("org_id" not in keys for keys in TOPIC_PAYLOAD_KEYS.values())
