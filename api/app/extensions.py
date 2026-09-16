"""Shared application objects: database engine, session scope, rate limiter."""

from __future__ import annotations

from typing import TYPE_CHECKING

from flask import Flask, current_app, g, request
from flask_limiter import Limiter
from sqlalchemy import create_engine
from sqlalchemy.orm import Session as OrmSession
from sqlalchemy.orm import sessionmaker

if TYPE_CHECKING:
    from .config import Config
    from .security.crypto import Keyring


def rate_limit_key() -> str:
    """Rate-limit bucket keyed by a hashed address, never a raw one.

    The limiter's storage would otherwise become one more place client
    addresses accumulate. Hashing keeps the buckets just as effective and the
    store itself uninteresting to an attacker who reaches it.
    """
    from .security.privacy import client_ip, hash_ip

    config = app_config()
    ip = client_ip(request, trusted_proxy_hops=config.trusted_proxy_hops)
    digest = hash_ip(config.token_pepper, ip)
    return digest.hex() if digest else "anonymous"


limiter = Limiter(key_func=rate_limit_key, storage_uri="memory://")


def init_engine(app: Flask, config: Config) -> None:
    engine = create_engine(
        config.database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        pool_recycle=1800,
        # Statement text carries ciphertext and blind indexes; never echo it.
        echo=False,
        future=True,
    )
    app.extensions["db_engine"] = engine
    app.extensions["db_sessionmaker"] = sessionmaker(
        bind=engine, expire_on_commit=False, future=True
    )


def db_session() -> OrmSession:
    """The request-scoped session, created lazily."""
    if "db_session" not in g:
        g.db_session = current_app.extensions["db_sessionmaker"]()
    return g.db_session


def close_db_session(exception: BaseException | None = None) -> None:
    session: OrmSession | None = g.pop("db_session", None)
    if session is None:
        return
    try:
        if exception is not None:
            session.rollback()
    finally:
        session.close()


def keyring() -> Keyring:
    return current_app.extensions["keyring"]


def app_config() -> Config:
    return current_app.extensions["dlt_config"]
