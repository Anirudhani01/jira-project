"""Tenancy tables (M3): organizations, memberships and seeded per-org configuration.

All rows are protected by FORCED row-level security (migration 0004). Every policy is
written for the runtime roles and checks the bound context (``app_current_org()`` /
``app_current_user()``) *and* the caller's active membership, through SECURITY DEFINER
helpers so policies never recurse. ``organizations.slug`` is immutable (column-level
UPDATE grant); memberships are soft-removed (``removed_at``), never deleted.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    SmallInteger,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

ORG_ROLES = ("owner", "admin", "member")
ISSUE_TYPE_KINDS = ("epic", "standard", "subtask")
SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{1,38}$"
MAX_ORG_NAME_LENGTH = 100


class Organization(Base):
    __tablename__ = "organizations"
    __table_args__ = (
        CheckConstraint(f"slug ~ '{SLUG_PATTERN}'", name="slug_format"),
        CheckConstraint(
            f"name = btrim(name) AND char_length(name) BETWEEN 1 AND {MAX_ORG_NAME_LENGTH}",
            name="name_valid",
        ),
        # No RETURNING: a row becomes visible to its creator only once the owner
        # membership exists (SELECT policy), so INSERT ... RETURNING would be refused.
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    slug: Mapped[str] = mapped_column(CITEXT, unique=True)
    name: Mapped[str] = mapped_column(String(MAX_ORG_NAME_LENGTH))
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class OrgMembership(Base):
    __tablename__ = "org_memberships"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="role_valid"),
        Index("ix_org_memberships_user_id_org_id", "user_id", "org_id"),
        {"implicit_returning": False},
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16))
    # D9 Option B: explicit, owner/admin-set grant (endpoint arrives in M4).
    can_create_projects: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    removed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class IssueType(Base):
    __tablename__ = "issue_types"
    __table_args__ = (
        CheckConstraint("kind IN ('epic', 'standard', 'subtask')", name="kind_valid"),
        UniqueConstraint("org_id", "id"),
        UniqueConstraint("org_id", "name"),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(CITEXT)
    kind: Mapped[str] = mapped_column(String(16))
    position: Mapped[int] = mapped_column(Integer)


class Priority(Base):
    __tablename__ = "priorities"
    __table_args__ = (
        UniqueConstraint("org_id", "id"),
        UniqueConstraint("org_id", "name"),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(CITEXT)
    sort_order: Mapped[int] = mapped_column(Integer)
    color: Mapped[str] = mapped_column(String(7))


INVITATION_TTL_DAYS = 7


class OrganizationSettings(Base):
    """Per-organization display and planning defaults (A5, B1).

    One row per org; inserted in the org-creation transaction and backfilled for existing
    orgs. Protected by FORCED RLS (migration 0019).
    """

    __tablename__ = "organization_settings"
    __table_args__ = (
        CheckConstraint(
            "story_points_max BETWEEN 1 AND 100",
            name="story_points_max_range",
        ),
        {"implicit_returning": False},
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        primary_key=True,
    )
    timezone: Mapped[str] = mapped_column(String(64), server_default=text("'UTC'"))
    locale: Mapped[str] = mapped_column(String(255), server_default=text("'en-US'"))
    story_points_enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    story_points_max: Mapped[int] = mapped_column(SmallInteger, server_default=text("100"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class OrgInvitation(Base):
    """Pending/accepted/revoked invitations (M4). Only the token's SHA-256 hash is stored;
    the worker mints the token when it sends the email."""

    __tablename__ = "org_invitations"
    __table_args__ = (
        CheckConstraint("role IN ('owner', 'admin', 'member')", name="role_valid"),
        ForeignKeyConstraint(
            ["org_id", "invited_by"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_org_invitations_org_id_org_memberships",
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["org_id", "accepted_by"],
            ["org_memberships.org_id", "org_memberships.user_id"],
            name="fk_org_invitations_org_id_accepted_by_org_memberships",
            ondelete="RESTRICT",
        ),
        UniqueConstraint("org_id", "id"),
        UniqueConstraint("token_hash"),
        Index(
            "uq_org_invitations_org_id_email_pending",
            "org_id",
            "email",
            unique=True,
            postgresql_where=text("accepted_at IS NULL AND revoked_at IS NULL"),
        ),
        {"implicit_returning": False},
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()")
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="RESTRICT")
    )
    email: Mapped[str] = mapped_column(CITEXT)
    role: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[bytes | None] = mapped_column(LargeBinary)
    invited_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    accepted_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
