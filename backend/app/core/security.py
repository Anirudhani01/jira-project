"""Cryptographic primitives: opaque tokens, derived keys, keyed hashes.

Keys for different purposes are derived from ``APP_SECRET_KEY`` with domain separation,
so a value computed for one purpose (e.g. CSRF) can never be replayed for another.
"""

import hashlib
import hmac
import secrets
from enum import StrEnum

from pydantic import SecretStr

SESSION_TOKEN_BYTES = 32


class KeyPurpose(StrEnum):
    CSRF = "csrf-v1"
    EMAIL_HMAC = "email-hmac-v1"
    RATE_LIMIT = "rate-limit-v1"


class SecretKeys:
    def __init__(self, app_secret_key: SecretStr) -> None:
        root = app_secret_key.get_secret_value().encode()
        self._keys = {
            purpose: hmac.new(root, purpose.value.encode(), hashlib.sha256).digest()
            for purpose in KeyPurpose
        }

    def mac(self, purpose: KeyPurpose, value: str) -> str:
        return hmac.new(self._keys[purpose], value.encode(), hashlib.sha256).hexdigest()

    def email_hmac(self, email: str) -> str:
        """Stable pseudonymous identifier for an email (correlation without storage)."""
        return self.mac(KeyPurpose.EMAIL_HMAC, normalize_email(email))

    def csrf_token(self, session_token: str) -> str:
        """CSRF token bound to the session: derivable only with the session cookie."""
        return self.mac(KeyPurpose.CSRF, session_token)

    def csrf_matches(self, session_token: str, presented: str) -> bool:
        return hmac.compare_digest(self.csrf_token(session_token), presented)


def new_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def hash_token(token: str) -> bytes:
    """Tokens have 256 bits of entropy, so an unsalted SHA-256 is sufficient at rest."""
    return hashlib.sha256(token.encode()).digest()


def normalize_email(email: str) -> str:
    return email.strip().lower()
