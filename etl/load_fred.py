"""Load FRED series history into ``fred_series`` and the latest snapshot into ``macro_snapshot``.

Series (Louisiana equivalents of the Houston job's CBSA 26420 series):
    ATNHPIUS35380Q  All-Transactions HPI, New Orleans-Metairie MSA (quarterly)
    ATNHPIUS22051A  HPI, Jefferson Parish (annual)
    ATNHPIUS22071A  HPI, Orleans Parish (annual)
    MORTGAGE30US    30-year fixed mortgage rate (weekly, national)
plus the realtor.com monthly listing series for the MSA.

Each series lands with its normalized (geo_level, geo_id) so it joins to the
parcel and market tables on the same keys as Redfin/Zillow.

Fail-soft: a missing FRED_API_KEY skips the load entirely (existing rows kept),
a failed series keeps its previous rows, and a snapshot in which *every* series
failed keeps the previous ``macro_snapshot`` instead of replacing it with error
dicts — one dead upstream must not wipe the last good snapshot. A fresh database
with no previous snapshot still lands the error snapshot, so the failure is
visible in the data and the table exists for downstream readers.
"""

import json
from datetime import datetime, timezone

import duckdb

from . import config, fred_client


def _snapshot_has_values(snapshot: dict) -> bool:
    """True when at least one series fetched real data (no "error" entry)."""
    return any(isinstance(series, dict) and "error" not in series for series in snapshot.values())


def _snapshot_exists(con: duckdb.DuckDBPyConnection) -> bool:
    return (
        con.execute(
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'macro_snapshot'"
        ).fetchone()[0]
        > 0
    )


def _previous_snapshot(con: duckdb.DuckDBPyConnection) -> dict:
    if not _snapshot_exists(con):
        return {}
    row = con.execute("SELECT snapshot FROM macro_snapshot ORDER BY fetched_at DESC LIMIT 1").fetchone()
    return json.loads(row[0]) if row and row[0] else {}


def _keep_last_good(snapshot: dict, previous: dict) -> dict:
    """A series that failed this time keeps its last good entry, which carries its own date, so one
    dead series can't blank a figure the site shows (the mortgage rate) while others succeed."""
    return {
        key: previous[key]
        if "error" in entry and isinstance(previous.get(key), dict) and "error" not in previous[key]
        else entry
        for key, entry in snapshot.items()
    }


def load(con: duckdb.DuckDBPyConnection, series: dict | None = None) -> int:
    series = series or config.FRED_SERIES
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS fred_series (
            series_key VARCHAR, series_id VARCHAR, geo_level VARCHAR, geo_id VARCHAR,
            frequency VARCHAR, date DATE, value DOUBLE, fetched_at TIMESTAMP
        )
        """
    )
    if not fred_client.api_key():
        print("  fred_series: FRED_API_KEY not set — skipping (existing rows kept)")
        return con.execute("SELECT COUNT(*) FROM fred_series").fetchone()[0]

    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
    for key, (sid, geo_level, geo_id, freq) in series.items():
        try:
            obs = fred_client.fetch_observations(sid)
        except Exception as e:  # noqa: BLE001
            print(f"  fred_series: {sid} failed ({e}); keeping previous rows")
            continue
        rows = [(key, sid, geo_level, geo_id, freq, o["date"], o["value"], fetched_at) for o in obs]
        con.execute("BEGIN")
        con.execute("DELETE FROM fred_series WHERE series_id = ?", [sid])
        if rows:
            con.executemany("INSERT INTO fred_series VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)
        con.execute("COMMIT")
        print(f"  fred_series: {sid} {len(rows)} observations")

    snapshot = fred_client.get_macro_snapshot()
    if not _snapshot_has_values(snapshot) and _snapshot_exists(con):
        print("  macro_snapshot: all series failed; keeping previous snapshot")
    else:
        if not _snapshot_has_values(snapshot):
            print("  macro_snapshot: all series failed and no previous snapshot; landing error snapshot")
        snapshot = _keep_last_good(snapshot, _previous_snapshot(con))
        con.execute("CREATE OR REPLACE TABLE macro_snapshot (fetched_at TIMESTAMP, snapshot JSON)")
        con.execute("INSERT INTO macro_snapshot VALUES (?, ?)", [fetched_at, json.dumps(snapshot)])
    count = con.execute("SELECT COUNT(*) FROM fred_series").fetchone()[0]
    print(f"  fred_series: {count} rows total")
    return count


if __name__ == "__main__":
    load(duckdb.connect(str(config.DB_PATH)))
