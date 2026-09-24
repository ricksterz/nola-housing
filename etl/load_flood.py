"""Flood zone per parcel from FEMA's National Flood Hazard Layer (NFHL).

The Assessor's own FLOOD_ZONE field covers ~12% of Jefferson parcels and never has a base flood
elevation, so it isn't used. Instead this pulls FEMA's effective flood hazard zone polygons for
each parish that has parcels, places every parcel by its lot's center point (the same way ZIPs
are placed, see etl/geocode.py) and stores one row per parcel in ``parcel_flood``.

Only the per-parcel result is persisted — the polygons (tens of MB even simplified) live in a
temp table for the duration of the run. FEMA maps change slowly, so this runs monthly on its own
(etl/refresh_flood.py) rather than inside the daily assessor refresh, and a failed fetch leaves
the previous ``parcel_flood`` rows untouched rather than writing a partial result.

    python -m etl.load_flood
"""

import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import duckdb

from . import config
from .assessor.http import PoliteSession

log = logging.getLogger(__name__)

TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS parcel_flood (
        parish VARCHAR, parcel_id VARCHAR, flood_zone VARCHAR, flood_zone_subtype VARCHAR,
        flood_sfha BOOLEAN, nfhl_pulled_at TIMESTAMP
    )
"""


def ensure_table(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(TABLE_SQL)


def fetch_zone_pages(session: PoliteSession, dfirm_prefix: str, out_dir: Path) -> list[Path]:
    """Page through the NFHL flood hazard zones for one DFIRM; raises on any failed page."""
    pages, offset = [], 0
    while True:
        resp = session.get(
            config.NFHL_ZONES_URL.rstrip("/") + "/query",
            params={
                "where": f"DFIRM_ID LIKE '{dfirm_prefix}%'",
                "outFields": "FLD_ZONE,ZONE_SUBTY,SFHA_TF",
                "outSR": "4326",
                "geometryPrecision": "6",
                "maxAllowableOffset": str(config.NFHL_SIMPLIFY_DEGREES),
                "resultOffset": str(offset),
                "resultRecordCount": str(config.NFHL_PAGE_SIZE),
                "f": "json",
            },
        )
        resp.raise_for_status()
        page = json.loads(resp.content)
        if "error" in page:
            raise RuntimeError(f"NFHL query failed at offset {offset}: {page['error']}")
        features = page.get("features", [])
        if not features:
            return pages
        path = out_dir / f"nfhl_{dfirm_prefix}_{offset:06d}.json"
        path.write_bytes(resp.content)
        pages.append(path)
        print(f"  NFHL {dfirm_prefix}: {offset + len(features)} zones fetched")
        if not page.get("exceededTransferLimit") and len(features) < config.NFHL_PAGE_SIZE:
            return pages
        offset += len(features)


# A handful of levee-protected zone X polygons are enormous (Jefferson's largest has ~57k vertices
# and spans most of the East Bank), so nearly every parcel is a candidate for them and a direct
# point-in-polygon join ran out of memory at 12+ GB. Cutting polygons over TILE_VERTICES into
# TILE_DEGREES grid cells keeps every piece small with a tight bounding box: ~20 s to tile, <1 s
# to join. Simplification (NFHL_SIMPLIFY_DEGREES) leaves ~25% of polygons self-intersecting, so
# they're repaired first or the cut fails with a topology error.
TILE_VERTICES = 500
TILE_DEGREES = 0.01  # ~1.1 km


def _tile_sql() -> str:
    return f"""
    CREATE OR REPLACE TEMP TABLE _nfhl_tiles AS
    WITH src AS (
        SELECT row_number() OVER () AS id, fld_zone, zone_subty, sfha_tf,
               CASE WHEN ST_IsValid(geom) THEN geom ELSE ST_MakeValid(geom) END AS geom
        FROM _nfhl
    ),
    big AS (SELECT * FROM src WHERE ST_NPoints(geom) > {TILE_VERTICES}),
    xs AS (
        SELECT id, unnest(range(floor(ST_XMin(geom) / {TILE_DEGREES})::BIGINT,
                                ceil(ST_XMax(geom) / {TILE_DEGREES})::BIGINT)) AS ix
        FROM big
    ),
    ys AS (
        SELECT id, unnest(range(floor(ST_YMin(geom) / {TILE_DEGREES})::BIGINT,
                                ceil(ST_YMax(geom) / {TILE_DEGREES})::BIGINT)) AS iy
        FROM big
    ),
    cells AS (
        SELECT xs.id, ST_MakeEnvelope(ix * {TILE_DEGREES}, iy * {TILE_DEGREES},
                                      (ix + 1) * {TILE_DEGREES}, (iy + 1) * {TILE_DEGREES}) AS cell
        FROM xs JOIN ys USING (id)
    ),
    pieces AS (
        SELECT b.fld_zone, b.zone_subty, b.sfha_tf, ST_Intersection(b.geom, c.cell) AS geom
        FROM big b JOIN cells c ON c.id = b.id
        WHERE ST_Intersects(b.geom, c.cell)
    )
    SELECT fld_zone, zone_subty, sfha_tf, geom FROM pieces WHERE NOT ST_IsEmpty(geom)
    UNION ALL
    SELECT fld_zone, zone_subty, sfha_tf, geom FROM src WHERE ST_NPoints(geom) <= {TILE_VERTICES}
"""


def assign_zones(con: duckdb.DuckDBPyConnection, parish: str, pages: list[Path], pulled_at) -> int:
    """Point-in-polygon every parcel of ``parish`` against the fetched zones; replaces that parish's rows."""
    con.execute(
        "CREATE OR REPLACE TEMP TABLE _nfhl "
        "(fld_zone VARCHAR, zone_subty VARCHAR, sfha_tf VARCHAR, geom GEOMETRY)"
    )
    for path in pages:
        con.execute(
            "INSERT INTO _nfhl SELECT FLD_ZONE, ZONE_SUBTY, SFHA_TF, geom FROM ST_Read(?)", [str(path)]
        )
    con.execute(_tile_sql())
    # A materialized point column (not ST_Point(...) inline in the ON clause) is what lets DuckDB
    # plan a SPATIAL_JOIN instead of a nested loop over every parcel × zone pair.
    con.execute(
        "CREATE OR REPLACE TEMP TABLE _pts AS SELECT parish, parcel_id, ST_Point(lng, lat) AS pt "
        "FROM assessor_parcels WHERE parish = ? AND lat IS NOT NULL AND lng IS NOT NULL",
        [parish],
    )
    con.execute("BEGIN")
    con.execute("DELETE FROM parcel_flood WHERE parish = ?", [parish])
    con.execute(
        """
        INSERT INTO parcel_flood
        SELECT parish, parcel_id, flood_zone, flood_zone_subtype, flood_sfha, ?
        FROM (
            SELECT p.parish, p.parcel_id,
                   z.fld_zone AS flood_zone,
                   NULLIF(TRIM(z.zone_subty), '') AS flood_zone_subtype,
                   z.sfha_tf = 'T' AS flood_sfha,
                   -- Intersects (not Contains) so a lot center on a tile cut or a zone line still
                   -- matches; where it touches two zones, report the higher-risk one.
                   ROW_NUMBER() OVER (
                       PARTITION BY p.parish, p.parcel_id ORDER BY (z.sfha_tf = 'T') DESC, z.fld_zone
                   ) AS rn
            FROM _pts p
            JOIN _nfhl_tiles z ON ST_Intersects(z.geom, p.pt)
        ) WHERE rn = 1
        """,
        [pulled_at],
    )
    con.execute("COMMIT")
    for t in ("_nfhl", "_nfhl_tiles", "_pts"):
        con.execute(f"DROP TABLE {t}")
    return con.execute("SELECT COUNT(*) FROM parcel_flood WHERE parish = ?", [parish]).fetchone()[0]


def load(con: duckdb.DuckDBPyConnection, parishes=None, session: PoliteSession | None = None) -> dict:
    con.execute("INSTALL spatial")
    con.execute("LOAD spatial")
    ensure_table(con)
    # hazards.fema.gov drops connections intermittently (observed outages of ~15–30 s): back off
    # 3 → 6 → … → 96 s before giving up.
    session = session or PoliteSession(min_interval=3.0, max_retries=6)
    have = {r[0] for r in con.execute("SELECT DISTINCT parish FROM assessor_parcels").fetchall()}
    out = {}
    for parish in parishes or config.PARISHES:
        if parish not in have:
            print(f"  [{parish}] no parcels loaded; skipping flood zones")
            continue
        pulled_at = datetime.now(timezone.utc).replace(tzinfo=None)
        with tempfile.TemporaryDirectory(prefix="nfhl_") as tmp:
            pages = fetch_zone_pages(session, config.NFHL_DFIRM_PREFIX[parish], Path(tmp))
            if not pages:
                raise RuntimeError(f"NFHL returned no flood zones for {parish}; refusing to clear its rows")
            out[parish] = assign_zones(con, parish, pages, pulled_at)
        print(f"  [{parish}] flood zone assigned to {out[parish]} parcels")
    return out


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    con = duckdb.connect(str(config.DB_PATH))
    load(con)
    con.close()


if __name__ == "__main__":
    main()
