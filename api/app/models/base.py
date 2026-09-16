"""Declarative base and shared column types."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import DateTime, MetaData
from sqlalchemy.orm import DeclarativeBase, mapped_column
from sqlalchemy.types import LargeBinary

SCHEMA = "dlt"

# Explicit, deterministic constraint names keep Alembic autogenerate stable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(schema=SCHEMA, naming_convention=NAMING_CONVENTION)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def uuid_pk():
    return mapped_column(primary_key=True, default=uuid.uuid4)


def timestamp(*, default_now: bool = False, nullable: bool = True, index: bool = False):
    """A timezone-aware timestamp. Everything is stored in UTC."""
    return mapped_column(
        DateTime(timezone=True),
        nullable=nullable,
        index=index,
        default=utcnow if default_now else None,
    )


def ciphertext(*, nullable: bool = True):
    """An AES-GCM sealed value: version byte, nonce, ciphertext and tag."""
    return mapped_column(LargeBinary, nullable=nullable)


def digest(*, unique: bool = False, nullable: bool = False, index: bool = False):
    """A 32-byte HMAC-SHA256 output used as a lookup key."""
    return mapped_column(LargeBinary(32), unique=unique, nullable=nullable, index=index)
