"""pre-issued tags

Revision ID: f3c81a6b47e9
Revises: e7b25c910d34
Create Date: 2026-09-17 19:10:00.000000

Physical tags are printed and shipped before the buyer has an account, so the
scan code has to exist while there is still no user to own it and no data key
to seal it under. A claim carries its own key, wrapped by the same keyring that
wraps a user's, and is turned into a real tag when the address registers.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f3c81a6b47e9"
down_revision = "e7b25c910d34"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tag_claims",
        sa.Column("id", sa.UUID(), primary_key=True),
        sa.Column("email_bidx", sa.LargeBinary(length=32), nullable=False),
        sa.Column("email_enc", sa.LargeBinary(), nullable=False),
        sa.Column("dek_wrapped", sa.LargeBinary(), nullable=False),
        sa.Column("dek_version", sa.SmallInteger(), nullable=False),
        sa.Column("token_hash", sa.LargeBinary(length=32), nullable=False),
        sa.Column("token_enc", sa.LargeBinary(), nullable=False),
        sa.Column("design_seed", sa.LargeBinary(), nullable=False),
        sa.Column("label_enc", sa.LargeBinary(), nullable=True),
        sa.Column("icon", sa.String(length=24), nullable=True),
        sa.Column("icon_color", sa.String(length=16), nullable=True),
        sa.Column("issued_by", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("claimed_tag_id", sa.UUID(), nullable=True),
        sa.ForeignKeyConstraint(["issued_by"], ["dlt.users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["claimed_tag_id"], ["dlt.tags.id"], ondelete="SET NULL"),
        sa.UniqueConstraint("token_hash", name=op.f("uq_tag_claims_token_hash")),
        schema="dlt",
    )
    op.create_index(op.f("ix_tag_claims_email_bidx"), "tag_claims", ["email_bidx"], schema="dlt")


def downgrade() -> None:
    op.drop_index(op.f("ix_tag_claims_email_bidx"), "tag_claims", schema="dlt")
    op.drop_table("tag_claims", schema="dlt")
