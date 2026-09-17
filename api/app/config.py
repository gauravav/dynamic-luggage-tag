"""Configuration, loaded from the environment and validated at startup.

Every secret is required in production. The app refuses to boot rather than
falling back to a default key — a silently weak key is worse than a crash.
"""

from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field

_KEK_PATTERN = re.compile(r"^DLT_KEK_V(\d+)$")


class ConfigError(RuntimeError):
    """Raised when the environment is missing or malformed."""


def _b64key(raw: str, name: str, length: int = 32) -> bytes:
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as exc:  # noqa: BLE001 - surfaced as a startup error
        raise ConfigError(f"{name} is not valid base64") from exc
    if len(key) != length:
        raise ConfigError(f"{name} must decode to {length} bytes, got {len(key)}")
    return key


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer") from exc


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise ConfigError(f"{name} is required")
    return value


@dataclass(frozen=True)
class Config:
    env: str
    debug: bool
    testing: bool

    secret_key: bytes
    database_url: str

    kek_versions: dict[int, bytes] = field(repr=False, default_factory=dict)
    kek_active_version: int = 1
    blind_index_key: bytes = field(repr=False, default=b"")
    token_pepper: bytes = field(repr=False, default=b"")

    frontend_origin: str = "http://localhost:5173"
    public_base_url: str = "http://localhost:5173"
    cookie_secure: bool = True
    cookie_domain: str | None = None

    session_idle_minutes: int = 60
    session_absolute_hours: int = 24 * 14
    max_sessions_per_user: int = 10

    password_min_length: int = 12
    login_max_attempts: int = 8
    login_lockout_minutes: int = 15

    argon2_time_cost: int = 3
    argon2_memory_cost: int = 64 * 1024
    argon2_parallelism: int = 2

    mail_provider: str = "console"
    mail_from: str = "no-reply@localhost"
    smtp: dict[str, str] = field(repr=False, default_factory=dict)

    geo_provider: str = "null"
    geo_headers: dict[str, str] = field(default_factory=dict)

    scan_retention_days: int = 90
    relay_retention_days: int = 30
    audit_retention_days: int = 365
    scan_dedup_minutes: int = 10
    scan_notify_cooldown_minutes: int = 30
    relay_notify_cooldown_minutes: int = 10

    ratelimit_storage_uri: str = "memory://"
    trusted_proxy_hops: int = 0

    max_content_length: int = 64 * 1024

    @property
    def active_kek(self) -> bytes:
        try:
            return self.kek_versions[self.kek_active_version]
        except KeyError as exc:
            raise ConfigError(
                f"DLT_KEK_ACTIVE_VERSION={self.kek_active_version} has no matching DLT_KEK_V key"
            ) from exc

    @property
    def is_production(self) -> bool:
        return self.env == "production"


def load_config(overrides: dict | None = None) -> Config:
    """Builds a Config from os.environ, applying `overrides` last (tests)."""
    overrides = overrides or {}
    env = overrides.get("env") or os.environ.get("DLT_ENV", "development")
    testing = bool(overrides.get("testing", False))

    keks: dict[int, bytes] = {}
    for name, value in os.environ.items():
        match = _KEK_PATTERN.match(name)
        if match and value:
            keks[int(match.group(1))] = _b64key(value, name)

    if "kek_versions" in overrides:
        keks = overrides["kek_versions"]
    if not keks:
        raise ConfigError("At least one DLT_KEK_V<n> key is required")

    cfg = Config(
        env=env,
        debug=_bool("DLT_DEBUG", env == "development") and not testing,
        testing=testing,
        secret_key=(overrides.get("secret_key") or _required("DLT_SECRET_KEY").encode()),
        database_url=overrides.get("database_url") or _required("DATABASE_URL"),
        kek_versions=keks,
        kek_active_version=_int("DLT_KEK_ACTIVE_VERSION", max(keks)),
        blind_index_key=(
            overrides.get("blind_index_key")
            or _b64key(_required("DLT_BLIND_INDEX_KEY"), "DLT_BLIND_INDEX_KEY")
        ),
        token_pepper=(
            overrides.get("token_pepper")
            or _b64key(_required("DLT_TOKEN_PEPPER"), "DLT_TOKEN_PEPPER")
        ),
        frontend_origin=os.environ.get("DLT_FRONTEND_ORIGIN", "http://localhost:5173"),
        public_base_url=os.environ.get("DLT_PUBLIC_BASE_URL", "http://localhost:5173"),
        cookie_secure=_bool("DLT_COOKIE_SECURE", env != "development"),
        cookie_domain=os.environ.get("DLT_COOKIE_DOMAIN") or None,
        session_idle_minutes=_int("DLT_SESSION_IDLE_MINUTES", 60),
        session_absolute_hours=_int("DLT_SESSION_ABSOLUTE_HOURS", 24 * 14),
        max_sessions_per_user=_int("DLT_MAX_SESSIONS_PER_USER", 10),
        password_min_length=_int("DLT_PASSWORD_MIN_LENGTH", 12),
        login_max_attempts=_int("DLT_LOGIN_MAX_ATTEMPTS", 8),
        login_lockout_minutes=_int("DLT_LOGIN_LOCKOUT_MINUTES", 15),
        argon2_time_cost=_int("DLT_ARGON2_TIME_COST", 3),
        argon2_memory_cost=_int("DLT_ARGON2_MEMORY_COST", 64 * 1024),
        argon2_parallelism=_int("DLT_ARGON2_PARALLELISM", 2),
        mail_provider=os.environ.get("DLT_MAIL_PROVIDER", "console"),
        mail_from=os.environ.get("DLT_MAIL_FROM", "no-reply@localhost"),
        smtp={
            "host": os.environ.get("DLT_SMTP_HOST", ""),
            "port": os.environ.get("DLT_SMTP_PORT", "587"),
            "username": os.environ.get("DLT_SMTP_USERNAME", ""),
            "password": os.environ.get("DLT_SMTP_PASSWORD", ""),
            "starttls": os.environ.get("DLT_SMTP_STARTTLS", "true"),
        },
        geo_provider=os.environ.get("DLT_GEO_PROVIDER", "null"),
        geo_headers={
            "city": os.environ.get("DLT_GEO_CITY_HEADER", "CF-IPCity"),
            "region": os.environ.get("DLT_GEO_REGION_HEADER", "CF-Region"),
            "country": os.environ.get("DLT_GEO_COUNTRY_HEADER", "CF-IPCountry"),
        },
        scan_retention_days=_int("DLT_SCAN_RETENTION_DAYS", 90),
        relay_retention_days=_int("DLT_RELAY_RETENTION_DAYS", 30),
        audit_retention_days=_int("DLT_AUDIT_RETENTION_DAYS", 365),
        scan_dedup_minutes=_int("DLT_SCAN_DEDUP_MINUTES", 10),
        scan_notify_cooldown_minutes=_int("DLT_SCAN_NOTIFY_COOLDOWN_MINUTES", 30),
        relay_notify_cooldown_minutes=_int("DLT_RELAY_NOTIFY_COOLDOWN_MINUTES", 10),
        ratelimit_storage_uri=os.environ.get("DLT_RATELIMIT_STORAGE_URI", "memory://"),
        trusted_proxy_hops=_int("DLT_TRUSTED_PROXY_HOPS", 0),
        max_content_length=_int("DLT_MAX_CONTENT_LENGTH", 64 * 1024),
    )

    if cfg.is_production:
        if not cfg.cookie_secure:
            raise ConfigError("DLT_COOKIE_SECURE cannot be false in production")
        if not cfg.public_base_url.startswith("https://"):
            raise ConfigError("DLT_PUBLIC_BASE_URL must be https:// in production")
        if "sslmode=" not in cfg.database_url:
            raise ConfigError("DATABASE_URL must specify sslmode in production")
    return cfg
