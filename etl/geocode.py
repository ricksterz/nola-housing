"""Backfill zip_code/city from a parcel's lat/lng via a spatial join.

Some assessor bulk sources (Jefferson's PAO layer) never populate ZIP/city —
those fields are present in the schema but always blank. Rather than trust a
free-text mailing address (unreliable for rentals/institutional owners), this
does the real thing: point-in-polygon against ZCTA boundaries for the ZIPs the
app tracks (etl/config.ZIPS). Parcels outside those boundaries (most of
Jefferson Parish extends past this app's target ZIPs) are left as-is.
"""

import logging

import duckdb

from . import config

log = logging.getLogger(__name__)


def backfill_zip_city(con: duckdb.DuckDBPyConnection, table: str = "assessor_parcels_raw") -> int:
    """Fill zip_code/city for rows with lat/lng but no zip_code or no city. Returns rows touched.

    The spatial extension installs on first use, which needs network access; if that's
    unavailable (offline dev, a sandboxed test run) this logs and returns 0 rather than
    failing the whole refresh — zip/city are an enrichment, not a hard requirement.
    """
    try:
        con.execute("INSTALL spatial")
        con.execute("LOAD spatial")
        con.execute(
            "CREATE OR REPLACE TEMP TABLE _zip_boundaries AS SELECT * FROM ST_Read(?)",
            [str(config.ZIP_BOUNDARIES_PATH)],
        )
    except Exception as e:  # noqa: BLE001 - spatial extension unavailable is not fatal
        log.warning("zip/city geocoding skipped (spatial extension unavailable): %s", e)
        return 0
    city_case = " ".join(f"WHEN '{zip_}' THEN '{city}'" for zip_, city in config.ZIP_CITY.items())
    result = con.execute(
        f"""
        UPDATE {table} AS t
        SET zip_code = COALESCE(t.zip_code, b.zip),
            city = COALESCE(t.city, CASE b.zip {city_case} END)
        FROM _zip_boundaries b
        WHERE (t.zip_code IS NULL OR t.city IS NULL)
          AND t.lat IS NOT NULL AND t.lng IS NOT NULL
          AND ST_Contains(b.geom, ST_Point(t.lng, t.lat))
        """
    )
    return result.fetchone()[0] if result.description else 0
