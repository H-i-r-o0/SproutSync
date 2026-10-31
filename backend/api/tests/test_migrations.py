"""Compile the full PostgreSQL upgrade path without touching a real database."""

from io import StringIO
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

from app.config import settings
from app.migration_support import REVISION_LENGTH


def test_alembic_config_handles_checkout_paths_with_spaces(tmp_path):
    api = tmp_path / "checkout with spaces" / "backend" / "api"
    api.mkdir(parents=True)
    original = Path(__file__).resolve().parents[1] / "alembic.ini"
    copied = api / "alembic.ini"
    copied.write_text(original.read_text(encoding="utf-8"), encoding="utf-8")
    config = Config(str(copied))
    paths = config.get_prepend_sys_paths_list()
    assert paths is not None
    assert [Path(path) for path in paths] == [api]


def test_fresh_upgrade_sql_supports_all_existing_revision_ids(monkeypatch):
    monkeypatch.setattr(
        settings,
        "database_url",
        "postgresql+psycopg://postgres:unused@localhost/postgres",
    )
    output = StringIO()
    config = Config(
        str(Path(__file__).resolve().parents[1] / "alembic.ini"), output_buffer=output
    )
    script = ScriptDirectory.from_config(config)
    assert script.get_current_head() == "0017_device_fault_alerts"
    assert (
        script.get_revision("0017_device_fault_alerts").down_revision
        == "0016_remove_demo_workspace_data"
    )
    assert (
        max(len(revision.revision) for revision in script.walk_revisions())
        <= REVISION_LENGTH
    )
    command.upgrade(config, "head", sql=True)
    sql = output.getvalue()
    assert f"version_num VARCHAR({REVISION_LENGTH})" in sql
    head = script.get_current_head()
    assert head is not None
    assert head in sql
    assert "CREATE TABLE users" in sql
    assert "public.request_operator_access" in sql
    assert "category in ('system', 'harvest', 'device')" in sql
    assert "alter publication supabase_realtime add table public.alerts" in sql
