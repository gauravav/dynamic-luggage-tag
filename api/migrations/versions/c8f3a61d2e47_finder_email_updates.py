"""finder email updates

Revision ID: c8f3a61d2e47
Revises: b41d7e2c9a05
Create Date: 2026-09-16 15:10:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c8f3a61d2e47"
down_revision = "b41d7e2c9a05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "relay_threads",
        sa.Column("finder_email_enc", sa.LargeBinary(), nullable=True),
        schema="dlt",
    )
    op.add_column(
        "relay_threads",
        sa.Column("finder_token_enc", sa.LargeBinary(), nullable=True),
        schema="dlt",
    )
    op.add_column(
        "relay_threads",
        sa.Column("finder_notified_at", sa.DateTime(timezone=True), nullable=True),
        schema="dlt",
    )


def downgrade() -> None:
    op.drop_column("relay_threads", "finder_notified_at", schema="dlt")
    op.drop_column("relay_threads", "finder_token_enc", schema="dlt")
    op.drop_column("relay_threads", "finder_email_enc", schema="dlt")
