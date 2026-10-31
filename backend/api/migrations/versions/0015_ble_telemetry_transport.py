"""Track whether a device's live telemetry is bridged over MQTT or Bluetooth."""

from alembic import op

revision = "0015_ble_telemetry_transport"
down_revision = "0015_evaluator_grants_and_inline_ratings"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    alter table public.devices
      add column telemetry_transport text not null default 'mqtt'
      check (telemetry_transport in ('mqtt', 'bluetooth'));
    NOTIFY pgrst, 'reload schema';
    """)


def downgrade() -> None:
    op.execute("""
    alter table public.devices drop column telemetry_transport;
    NOTIFY pgrst, 'reload schema';
    """)
