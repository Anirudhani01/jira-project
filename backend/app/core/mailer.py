"""Outgoing email over SMTP (standard library only; no paid API or SDK).

Development and tests use Mailpit, a free local SMTP sink. Production delivery requires an
explicitly configured, TLS-protected, authenticated provider (validated in config; provider
choice is a pending decision, D13/D14). Messages are plain text: no HTML templating in M2.
"""

import asyncio
import contextlib
import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate
from typing import Protocol

from app.core.config import Settings

logger = logging.getLogger("app.mailer")


@dataclass(frozen=True, slots=True)
class OutgoingEmail:
    to: str
    subject: str
    body: str
    # Stable per outbox job, so a redelivered job produces the same Message-ID and
    # providers/clients can recognise the duplicate (plan R4 handler idempotency).
    idempotency_key: str


class Mailer(Protocol):
    async def send(self, email: OutgoingEmail) -> None: ...


class EmailDeliveryDisabledError(RuntimeError):
    """Raised if sending is attempted while EMAIL_DELIVERY_ENABLED is false."""


def build_message(email: OutgoingEmail, sender: str) -> EmailMessage:
    message = EmailMessage()  # rejects CR/LF in header values (no header injection)
    message["From"] = sender
    message["To"] = email.to
    message["Subject"] = email.subject
    message["Date"] = formatdate(localtime=False)
    domain = sender.rsplit("@", 1)[-1]
    message["Message-ID"] = f"<{email.idempotency_key}@{domain}>"
    message.set_content(email.body)
    return message


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, email: OutgoingEmail) -> None:
        settings = self._settings
        if not settings.email_delivery_enabled or not settings.smtp_host or not settings.email_from:
            raise EmailDeliveryDisabledError("email delivery is not configured")
        message = build_message(email, settings.email_from)
        await asyncio.to_thread(self._send_sync, message)

    def _send_sync(self, message: EmailMessage) -> None:
        settings = self._settings
        host = settings.smtp_host or ""
        context = ssl.create_default_context()
        smtp: smtplib.SMTP
        if settings.smtp_security == "tls":
            smtp = smtplib.SMTP_SSL(
                host, settings.smtp_port, timeout=settings.smtp_timeout_seconds, context=context
            )
        else:
            smtp = smtplib.SMTP(host, settings.smtp_port, timeout=settings.smtp_timeout_seconds)
        try:
            if settings.smtp_security == "starttls":
                smtp.starttls(context=context)
            if settings.smtp_username and settings.smtp_password is not None:
                smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
            smtp.send_message(message)
            # Accepted by the server: the message counts as sent. A failing QUIT must not
            # turn it into a failure (that would retry and invalidate a delivered link).
            with contextlib.suppress(smtplib.SMTPException, OSError):
                smtp.quit()
        finally:
            smtp.close()
