"""watchers and name disclosure

Revision ID: e7b25c910d34
Revises: d1a4c7b93f26
Create Date: 2026-09-17 18:40:00.000000

A scan code is a bearer credential with no expiry. Someone who scans a bag
while it is safe learns nothing at the time — but can keep the URL, poll it,
and be handed the owner's name the moment the bag is reported lost.

This migration adds the three things that answer that: a record of retired
codes, counters that make automated watching visible, and a name-disclosure
mode so the name is released into one conversation rather than broadcast.

Retired codes are kept rather than discarded so they can keep resolving in a
reduced mode — a bag on an un-reprinted tag still comes home, while the name
stays unreleased. They therefore have no expiry: the tag carrying one may
never be reprinted.

Existing tags are moved to `on_reply` (or `never`, where the owner had already
turned the name off) rather than left on `always`, because every tag printed
before today has the same exposure.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e7b25c910d34"
down_revision = "d1a4c7b93f26"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "retired_tokens",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("tag_id", sa.UUID(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(length=32), nullable=False),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["tag_id"], ["dlt.tags.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("token_hash", name=op.f("uq_retired_tokens_token_hash")),
        schema="dlt",
    )
    op.create_index(op.f("ix_retired_tokens_tag_id"), "retired_tokens", ["tag_id"], schema="dlt")
    op.add_column(
        "tags",
        sa.Column("page_fetch_count", sa.Integer(), nullable=False, server_default="0"),
        schema="dlt",
    )
    op.add_column(
        "tags",
        sa.Column("stale_scan_count", sa.Integer(), nullable=False, server_default="0"),
        schema="dlt",
    )
    op.add_column(
        "tags",
        sa.Column("last_stale_scan_at", sa.DateTime(timezone=True), nullable=True),
        schema="dlt",
    )
    op.add_column(
        "tags",
        sa.Column("block_retired_tokens", sa.Boolean(), nullable=False, server_default="false"),
        schema="dlt",
    )

    op.add_column(
        "tags",
        sa.Column(
            "name_disclosure", sa.String(length=16), nullable=False, server_default="on_reply"
        ),
        schema="dlt",
    )
    # Carry the old boolean across: a tag that showed the name moves to
    # releasing it per conversation, one that did not keeps saying nothing.
    op.execute(
        "UPDATE dlt.tags SET name_disclosure = CASE WHEN reveal_name THEN 'on_reply' ELSE 'never' END"
    )
    op.create_check_constraint(
        "name_disclosure_valid",
        "tags",
        "name_disclosure IN ('always', 'on_reply', 'never')",
        schema="dlt",
    )
    op.drop_column("tags", "reveal_name", schema="dlt")


def downgrade() -> None:
    op.add_column(
        "tags",
        sa.Column("reveal_name", sa.Boolean(), nullable=False, server_default="true"),
        schema="dlt",
    )
    op.execute("UPDATE dlt.tags SET reveal_name = (name_disclosure <> 'never')")
    op.drop_constraint("ck_tags_name_disclosure_valid", "tags", schema="dlt")
    op.drop_column("tags", "name_disclosure", schema="dlt")
    op.drop_column("tags", "block_retired_tokens", schema="dlt")
    op.drop_column("tags", "last_stale_scan_at", schema="dlt")
    op.drop_column("tags", "stale_scan_count", schema="dlt")
    op.drop_column("tags", "page_fetch_count", schema="dlt")
    op.drop_index(op.f("ix_retired_tokens_tag_id"), "retired_tokens", schema="dlt")
    op.drop_table("retired_tokens", schema="dlt")
