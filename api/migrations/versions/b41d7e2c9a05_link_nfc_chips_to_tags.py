"""link nfc chips to tags

Revision ID: b41d7e2c9a05
Revises: fce7a829e1fd
Create Date: 2026-09-16 14:20:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b41d7e2c9a05"
down_revision = "fce7a829e1fd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tags", sa.Column("nfc_uid_bidx", sa.LargeBinary(length=32), nullable=True), schema="dlt"
    )
    op.add_column(
        "tags", sa.Column("nfc_bound_at", sa.DateTime(timezone=True), nullable=True), schema="dlt"
    )
    op.create_unique_constraint(
        op.f("uq_tags_nfc_uid_bidx"), "tags", ["nfc_uid_bidx"], schema="dlt"
    )


def downgrade() -> None:
    op.drop_constraint(op.f("uq_tags_nfc_uid_bidx"), "tags", schema="dlt", type_="unique")
    op.drop_column("tags", "nfc_bound_at", schema="dlt")
    op.drop_column("tags", "nfc_uid_bidx", schema="dlt")
