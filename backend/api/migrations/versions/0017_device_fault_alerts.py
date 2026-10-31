"""Allow live device-fault alerts and publish them to workspace notifications."""

from alembic import op

revision = "0017_device_fault_alerts"
down_revision = "0016_remove_demo_workspace_data"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    alter table public.alerts drop constraint alerts_category_check;
    alter table public.alerts add constraint alerts_category_check
      check (category in ('system', 'harvest', 'device'));

    do $$
    begin
      if exists(select 1 from pg_publication where pubname = 'supabase_realtime')
        and not exists(
          select 1 from pg_publication_tables
          where pubname = 'supabase_realtime'
            and schemaname = 'public'
            and tablename = 'alerts'
        ) then
        alter publication supabase_realtime add table public.alerts;
      end if;
    end $$;
    NOTIFY pgrst, 'reload schema';
    """)


def downgrade() -> None:
    op.execute("""
    update public.alerts set category = 'system' where category = 'device';
    alter table public.alerts drop constraint alerts_category_check;
    alter table public.alerts add constraint alerts_category_check
      check (category in ('system', 'harvest'));
    NOTIFY pgrst, 'reload schema';
    """)
