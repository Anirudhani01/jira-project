"""Request/response models. Requests forbid unknown fields (no mass assignment)."""

import re
import uuid
from datetime import datetime
from typing import Annotated, Literal

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.core.security import normalize_email
from app.modules.identity.passwords import MAX_PASSWORD_LENGTH

# Deliberately simple (RFC 5322 is not the goal); deliverability is proven by M2 verification.
_EMAIL_PATTERN = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$")
MAX_EMAIL_LENGTH = 254


def _validate_email(value: str) -> str:
    value = normalize_email(value)
    if len(value) > MAX_EMAIL_LENGTH or not _EMAIL_PATTERN.fullmatch(value):
        raise ValueError("must be a valid email address")
    return value


Email = Annotated[str, Field(max_length=320), AfterValidator(_validate_email)]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
# Length policy (12+) is enforced by the password policy so the rejection is uniform.
Password = Annotated[str, Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)]
# Email-link tokens are URL-safe base64 (43 chars for 32 bytes); anything else is invalid.
EmailToken = Annotated[str, Field(min_length=16, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")]


class _Request(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SignupRequest(_Request):
    email: Email
    password: Password
    display_name: DisplayName


class LoginRequest(_Request):
    email: Email
    password: Password


class ChangePasswordRequest(_Request):
    current_password: Password
    new_password: Password


class UpdateProfileRequest(_Request):
    display_name: DisplayName


class VerifyEmailRequest(_Request):
    token: EmailToken


class PasswordResetRequest(_Request):
    email: Email


class PasswordResetConfirmRequest(_Request):
    token: EmailToken
    new_password: Password


class AcceptedResponse(BaseModel):
    status: Literal["accepted"] = "accepted"


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    display_name: str
    email_verified: bool


class SessionInfo(BaseModel):
    id: uuid.UUID
    expires_at: datetime


class SessionStateResponse(BaseModel):
    user: UserResponse
    csrf_token: str
    session: SessionInfo


class SessionListItem(BaseModel):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool


class SessionListResponse(BaseModel):
    items: list[SessionListItem]
