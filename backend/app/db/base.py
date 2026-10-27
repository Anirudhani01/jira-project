"""Declarative base shared by all modules. Alembic compares migrations against it."""

from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def import_all_models() -> None:
    """Import every model module so Base.metadata is complete (used by Alembic)."""
    from app.modules.identity import models as identity_models  # noqa: F401, PLC0415
    from app.modules.outbox import models as outbox_models  # noqa: F401, PLC0415
    from app.modules.security_events import models as event_models  # noqa: F401, PLC0415
