"""Clear demo run/ticket/audit rows atomically; never touch the vector index.

Stop the backend first, then run: python scripts/reset_demo.py
DATA_DIR is loaded through the application's normal Settings configuration.
"""
from contextlib import closing
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.app.config import Settings

TABLES = ('audit', 'tickets', 'runs')  # Dependants before their parent run.
DELETE_GUARDS = ('audit_no_delete', 'tickets_no_delete')


def reset_database(path: Path) -> dict[str, int]:
    """Restore deletion guards and all rows on failure; do not create a missing DB."""
    uri = path.resolve().as_uri() + '?mode=rw'
    with closing(sqlite3.connect(uri, uri=True, timeout=30)) as db, db:
        db.execute('PRAGMA foreign_keys=ON')
        db.execute('BEGIN IMMEDIATE')
        counts = {table: db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in TABLES}
        guards = db.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND name IN (?, ?)",
            DELETE_GUARDS,
        ).fetchall()
        # Schema changes are transactional too: no other writer sees disabled guards.
        for name, _ in guards:
            db.execute(f'DROP TRIGGER "{name}"')
        for table in TABLES:
            db.execute(f'DELETE FROM {table}')
        for _, sql in guards:
            db.execute(sql)  # execute, not executescript (which implicitly commits).
        if any(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] for table in TABLES):
            raise RuntimeError('Demo tables were not emptied')
        return counts


def main() -> int:
    try:
        counts = reset_database(Settings().data_dir / 'app.db')
    except (OSError, sqlite3.Error, ValueError, RuntimeError) as exc:
        print(f'FAIL: demo reset did not commit ({type(exc).__name__}).', file=sys.stderr)
        return 1
    for table in ('runs', 'tickets', 'audit'):
        print(f'{table}: deleted {counts[table]}, remaining 0')
    print('Vector index: untouched')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
