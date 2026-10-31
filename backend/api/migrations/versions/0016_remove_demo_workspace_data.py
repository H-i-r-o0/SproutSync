"""Remove seeded demo records and stop creating them for new workspaces."""

from alembic import op

revision = "0016_remove_demo_workspace_data"
down_revision = "0015_ble_telemetry_transport"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    create or replace function public.initialize_workspace()
    returns void language plpgsql security definer set search_path = '' as $$
    begin
      return;
    end $$;
    revoke all on function public.initialize_workspace() from public, anon;
    grant execute on function public.initialize_workspace() to authenticated;
    drop function public.seed_demo_records(integer);

    delete from public.alerts where is_demo;
    delete from public.telemetry_readings where is_demo;
    delete from public.watering_events where is_demo;
    delete from public.irrigation_schedules where is_demo;
    delete from public.maintenance_records where is_demo;
    delete from public.evidence_records where is_demo;
    delete from public.activity_logs where is_demo;
    delete from public.evaluations
      where batch_id in (select id from public.batches where is_demo);
    delete from public.batches where is_demo;
    delete from public.trays where is_demo;
    delete from public.devices where is_demo;
    NOTIFY pgrst, 'reload schema';
    """)


def downgrade() -> None:
    raise RuntimeError(
        "Demo workspace cleanup is irreversible; restore a database backup instead."
    )
