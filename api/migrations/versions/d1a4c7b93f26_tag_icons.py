"""tag icons

Revision ID: d1a4c7b93f26
Revises: c8f3a61d2e47
Create Date: 2026-09-17 16:40:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d1a4c7b93f26"
down_revision = "c8f3a61d2e47"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Plain columns, not ciphertext: both hold a name from a fixed list in
    # core/icons.py, and the icon is printed on the outside of the bag anyway.
    op.add_column("tags", sa.Column("icon", sa.String(length=24), nullable=True), schema="dlt")
    op.add_column(
        "tags", sa.Column("icon_color", sa.String(length=16), nullable=True), schema="dlt"
    )


def downgrade() -> None:
    op.drop_column("tags", "icon_color", schema="dlt")
    op.drop_column("tags", "icon", schema="dlt")
