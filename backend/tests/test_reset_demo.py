"""Reset-tool tests use temporary stores only; never the configured demo data."""
from contextlib import closing
import sqlite3

import pytest

from backend.app.audit import Store
from backend.app.ticket import draft_from_run
from scripts import reset_demo


@pytest.fixture
def populated(tmp_path, catalog):
    store = Store(tmp_path / 'app.db')
    run = catalog.runs['ALR-RAN'].model_copy(deep=True)
    store.save_run(run, {'alert_id': run.parsed.alert_id})
    ticket = store.save_ticket(draft_from_run(catalog.ticket, run))
    store.approve(ticket.ticket_id, 'Demo Analyst')
    return store, run


def schema(db):
    return db.execute('SELECT type,name,sql FROM sqlite_master ORDER BY type,name').fetchall()


def test_reset_removes_approved_data_keeps_schema_index_and_other_tables(populated, tmp_path, catalog):
    store, run = populated
    index = tmp_path / 'chroma' / 'index.bin'
    index.parent.mkdir()
    index.write_bytes(b'synthetic-vector-index')
    with closing(store.connect()) as db, db:
        db.execute('CREATE TABLE unrelated (value TEXT)')
        db.execute("INSERT INTO unrelated VALUES ('keep')")
        original_schema = schema(db)
    assert reset_demo.reset_database(store.path) == {'runs': 1, 'tickets': 1, 'audit': 6}
    with closing(store.connect()) as db:
        assert schema(db) == original_schema
        assert db.execute('SELECT value FROM unrelated').fetchall()[0][0] == 'keep'
        for table in reset_demo.TABLES:
            assert db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0
    assert index.read_bytes() == b'synthetic-vector-index'
    assert reset_demo.reset_database(store.path) == {'runs': 0, 'tickets': 0, 'audit': 0}
    # Restored guards still protect newly created approved tickets and audit rows.
    store.save_run(run, {'alert_id': run.parsed.alert_id})
    ticket = store.save_ticket(draft_from_run(catalog.ticket, run))
    store.approve(ticket.ticket_id, 'Demo Analyst')
    with closing(store.connect()) as db, db:
        for table in ('tickets', 'audit'):
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(f'DELETE FROM {table}')


def test_failed_reset_rolls_back_rows_and_guards(populated):
    store, _ = populated
    with closing(store.connect()) as db, db:
        db.execute("CREATE TRIGGER fail_reset BEFORE DELETE ON runs BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
        original_schema = schema(db)
    with pytest.raises(sqlite3.IntegrityError, match='forced failure'):
        reset_demo.reset_database(store.path)
    with closing(store.connect()) as db:
        assert schema(db) == original_schema
        assert [db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in ('runs', 'tickets', 'audit')] == [1, 1, 6]


def test_missing_database_is_not_created(tmp_path):
    path = tmp_path / 'missing.db'
    with pytest.raises(sqlite3.OperationalError):
        reset_demo.reset_database(path)
    assert not path.exists()


def test_cli_uses_configured_data_dir_and_prints_counts(populated, settings, monkeypatch, capsys):
    monkeypatch.setattr(reset_demo, 'Settings', lambda: settings)
    assert reset_demo.main() == 0
    assert capsys.readouterr().out.splitlines() == [
        'runs: deleted 1, remaining 0', 'tickets: deleted 1, remaining 0',
        'audit: deleted 6, remaining 0', 'Vector index: untouched',
    ]


def test_cli_failure_is_sanitized(tmp_path, settings, monkeypatch, capsys):
    monkeypatch.setattr(reset_demo, 'Settings', lambda: settings)
    assert reset_demo.main() == 1
    output = capsys.readouterr()
    assert not output.out
    assert output.err == 'FAIL: demo reset did not commit (OperationalError).\n'
