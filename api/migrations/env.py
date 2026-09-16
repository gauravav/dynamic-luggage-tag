"""Alembic environment.

The database URL comes from DATABASE_URL rather than alembic.ini so the
password never sits in a tracked file.
"""

from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import create_engine, pool, text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.models import SCHEMA, Base  # noqa: E402

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Restricts autogenerate to this application's own schema.

    Two things would otherwise pollute every diff:

    * alembic_version is reflected like any other table and, being absent from
      the metadata, is reported as a table to drop.
    * The app role's search_path includes dlt, so reflection finds each table
      twice — once unqualified through the search path, once as dlt.* — and
      every foreign key is then reported as both removed and added.
    """
    if type_ == "table":
        if name == "alembic_version":
            return False
        if reflected and getattr(obj, "schema", None) != SCHEMA:
            return False
    return True


def _url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is required to run migrations")
    return url


def run_migrations_offline() -> None:
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        include_schemas=True,
        include_object=include_object,
        version_table_schema=SCHEMA,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url(), poolclass=pool.NullPool, future=True)

    # Two separate connections on purpose. Probing for the schema on the same
    # connection would leave an open transaction, and Alembic then treats its
    # own begin_transaction() as already-inside-one and never commits — the
    # migration appears to run and silently rolls back on close.
    with engine.connect() as probe:
        exists = probe.scalar(
            text("SELECT 1 FROM information_schema.schemata WHERE schema_name = :name"),
            {"name": SCHEMA},
        )
        if not exists:
            # infra/scripts/db-up.sh normally creates this and makes the app
            # role its owner; this covers a database provisioned some other way.
            probe.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{SCHEMA}"'))
        probe.commit()

    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            include_schemas=True,
            include_object=include_object,
            version_table_schema=SCHEMA,
            compare_type=True,
            compare_server_default=True,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
