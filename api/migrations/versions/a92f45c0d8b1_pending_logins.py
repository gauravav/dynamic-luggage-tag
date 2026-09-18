"""pending logins

Revision ID: a92f45c0d8b1
Revises: f3c81a6b47e9
Create Date: 2026-09-17 21:00:00.000000

Signing in with two-factor on is two requests, and both demanded their own bot
check — so the same person proved they were a person twice, thirty seconds
apart, to complete one sign-in. The first request now issues a short-lived,
single-use ticket that lets the second skip it.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a92f45c0d8b1"
down_revision = "f3c81a6b47e9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "pending_logins",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["dlt.users.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash", name=op.f("uq_pending_logins_token_hash")),
        schema="dlt",
    )
    op.create_index(op.f("ix_pending_logins_user_id"), "pending_logins", ["user_id"], schema="dlt")
    op.create_index(
        op.f("ix_pending_logins_expires_at"), "pending_logins", ["expires_at"], schema="dlt"
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_pending_logins_expires_at"), "pending_logins", schema="dlt")
    op.drop_index(op.f("ix_pending_logins_user_id"), "pending_logins", schema="dlt")
    op.drop_table("pending_logins", schema="dlt")
