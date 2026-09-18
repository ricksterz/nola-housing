"""Load FRED series history into ``fred_series`` and the latest snapshot into ``macro_snapshot``.

Series (Louisiana equivalents of the Houston job's CBSA 26420 series):
    ATNHPIUS35380Q  All-Transactions HPI, New Orleans-Metairie MSA (quarterly)
    ATNHPIUS22051A  HPI, Jefferson Parish (annual)
    ATNHPIUS22071A  HPI, Orleans Parish (annual)
    MORTGAGE30US    30-year fixed mortgage rate (weekly, national)
plus the realtor.com monthly listing series for the MSA.

Each series lands with its normalized (geo_level, geo_id) so it joins to the
parcel and market tables on the same keys as Redfin/Zillow.
"""

import json
from datetime import datetime, timezone

import duckdb

from . import config, fred_client


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
    con.execute("CREATE OR REPLACE TABLE macro_snapshot (fetched_at TIMESTAMP, snapshot JSON)")
    con.execute("INSERT INTO macro_snapshot VALUES (?, ?)", [fetched_at, json.dumps(snapshot)])
    count = con.execute("SELECT COUNT(*) FROM fred_series").fetchone()[0]
    print(f"  fred_series: {count} rows total")
    return count


if __name__ == "__main__":
    load(duckdb.connect(str(config.DB_PATH)))
