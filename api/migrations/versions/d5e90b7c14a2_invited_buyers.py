"""invitations and buyer names on pre-issued tags

Revision ID: d5e90b7c14a2
Revises: a92f45c0d8b1
Create Date: 2026-09-18 10:20:00.000000

The operator now takes the buyer's name with the order — it is printed on the
tag, so it has to be known before the account exists — and mails an invitation
to the address the code was issued to. The invitation is what carries the
address and the name into registration, which is why only its hash is stored:
it is sent once, and re-sending mints a new one.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d5e90b7c14a2"
down_revision = "a92f45c0d8b1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tag_claims", sa.Column("name_enc", sa.LargeBinary(), nullable=True), schema="dlt"
    )
    op.add_column(
        "tag_claims",
        sa.Column("invite_token_hash", sa.LargeBinary(length=32), nullable=True),
        schema="dlt",
    )
    op.add_column(
        "tag_claims",
        sa.Column("invite_sent_at", sa.DateTime(timezone=True), nullable=True),
        schema="dlt",
    )
    op.create_unique_constraint(
        op.f("uq_tag_claims_invite_token_hash"),
        "tag_claims",
        ["invite_token_hash"],
        schema="dlt",
    )


def downgrade() -> None:
    op.drop_constraint(
        op.f("uq_tag_claims_invite_token_hash"), "tag_claims", schema="dlt", type_="unique"
    )
    op.drop_column("tag_claims", "invite_sent_at", schema="dlt")
    op.drop_column("tag_claims", "invite_token_hash", schema="dlt")
    op.drop_column("tag_claims", "name_enc", schema="dlt")
