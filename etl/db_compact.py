"""Reclaim disk space DuckDB's own VACUUM doesn't.

Unlike SQLite, DuckDB's VACUUM rebuilds statistics but does not shrink the file — the delete+
reinsert cycle every refresh does (assessor_parcels_raw) and every CREATE OR REPLACE TABLE
(build_join, build_derived) leaves old pages unreclaimed, so the file only grows run over run.
One refresh cycle alone was observed to grow it from 65 to 98 MiB. Copying into a fresh file via
COPY FROM DATABASE — the documented way to actually compact a DuckDB file — and swapping it in
is the fix; confirmed it takes that same file back down to 67 MiB.
"""

import os

import duckdb


def compact(con: duckdb.DuckDBPyConnection, db_path) -> None:
    """Closes ``con``. Callers should treat it as the last thing done with the connection."""
    db_path = str(db_path)
    tmp_path = db_path + ".compact.tmp"
    if os.path.exists(tmp_path):
        os.remove(tmp_path)
    name = con.execute("SELECT current_database()").fetchone()[0]
    con.execute(f"ATTACH '{tmp_path}' AS _compacted")
    con.execute(f'COPY FROM DATABASE "{name}" TO _compacted')
    con.execute("DETACH _compacted")
    con.close()
    os.replace(tmp_path, db_path)
