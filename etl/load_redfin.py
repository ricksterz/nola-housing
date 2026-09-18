"""Load Redfin market tracker data for the New Orleans–Metairie market.

Source is Redfin's public Data Center (the ``redfin-public-data`` S3 bucket, not a
scrape). Three trackers are pulled and landed in one long table, ``redfin_market``,
keyed by the normalized (geo_level, geo_id):

    county  -> Jefferson Parish (22051) and Orleans Parish (22071)
    metro   -> New Orleans-Metairie, LA (CBSA 35380)
    zip     -> the Metairie / Old Metairie / New Orleans ZIPs in etl.config

Column names match the Houston ``redfin_market`` table so the comps app's market
queries work unchanged (see the ``redfin_market_zip`` view in build_join).

Override any feed with REDFIN_COUNTY_SOURCE / REDFIN_METRO_SOURCE / REDFIN_ZIP_SOURCE
to point at local files for offline development.
"""

import duckdb

from . import config

# Redfin's tracker files share one schema. Everything is read as VARCHAR and cast
# explicitly so a malformed value in one national row cannot break the load.
CSV_OPTS = "delim='\\t', header=true, all_varchar=true, ignore_errors=true"

_SELECT = """
    SELECT
        '{geo_level}' AS geo_level,
        {geo_id_expr} AS geo_id,
        REGION AS region_name,
        TRY_CAST(PERIOD_BEGIN AS DATE) AS period_begin,
        TRY_CAST(PERIOD_END AS DATE) AS period_end,
        TRY_CAST(PERIOD_DURATION AS INTEGER) AS period_duration_days,
        PROPERTY_TYPE AS property_type,
        CASE WHEN TRY_CAST(PERIOD_DURATION AS INTEGER) = 30 THEN 'monthly'
             WHEN TRY_CAST(PERIOD_DURATION AS INTEGER) = 90 THEN 'rolling_3mo'
             ELSE 'other' END AS frequency,
        TRY_CAST(HOMES_SOLD AS DOUBLE) AS homes_sold,
        TRY_CAST(MEDIAN_SALE_PRICE AS DOUBLE) AS median_sale_price,
        TRY_CAST(MEDIAN_DOM AS DOUBLE) AS median_dom,
        TRY_CAST(AVG_SALE_TO_LIST AS DOUBLE) * 100 AS sale_to_list_ratio,
        TRY_CAST(SOLD_ABOVE_LIST AS DOUBLE) * 100 AS pct_sold_above_list,
        TRY_CAST(NEW_LISTINGS AS DOUBLE) AS new_listings,
        TRY_CAST(INVENTORY AS DOUBLE) AS active_listings,
        TRY_CAST(PENDING_SALES AS DOUBLE) AS pending_sales,
        TRY_CAST(MEDIAN_LIST_PRICE AS DOUBLE) AS median_new_listing_price,
        TRY_CAST(MEDIAN_PPSF AS DOUBLE) AS median_sale_price_psf,
        TRY_CAST(PRICE_DROPS AS DOUBLE) * 100 AS pct_price_drops,
        -- Redfin omits MONTHS_OF_SUPPLY for small regions; derive from
        -- inventory / (homes sold per month) using the window length.
        COALESCE(
            TRY_CAST(MONTHS_OF_SUPPLY AS DOUBLE),
            CASE WHEN TRY_CAST(HOMES_SOLD AS DOUBLE) > 0
                 THEN ROUND(TRY_CAST(INVENTORY AS DOUBLE)
                            * (TRY_CAST(PERIOD_DURATION AS DOUBLE) / 30.0)
                            / TRY_CAST(HOMES_SOLD AS DOUBLE), 2)
            END
        ) AS months_of_supply,
        TRY_CAST(OFF_MARKET_IN_TWO_WEEKS AS DOUBLE) * 100 AS pct_off_market_2wk,
        TRY_CAST(LAST_UPDATED AS TIMESTAMP) AS source_last_updated
    FROM read_csv('{path}', {csv_opts})
    WHERE PROPERTY_TYPE = 'All Residential'
      AND {region_filter}
"""


def _county_sql() -> str:
    cases = " ".join(f"WHEN '{name}' THEN '{fips}'" for name, fips in config.REDFIN_COUNTY_REGIONS.items())
    names = ", ".join(f"'{n}'" for n in config.REDFIN_COUNTY_REGIONS)
    return _SELECT.format(
        geo_level="county",
        geo_id_expr=f"CASE REGION {cases} END",
        path=config.REDFIN_SOURCES["county"],
        csv_opts=CSV_OPTS,
        region_filter=f"REGION_TYPE = 'county' AND STATE_CODE = 'LA' AND REGION IN ({names})",
    )


def _metro_sql() -> str:
    return _SELECT.format(
        geo_level="metro",
        geo_id_expr=f"'{config.CBSA_CODE}'",
        path=config.REDFIN_SOURCES["metro"],
        csv_opts=CSV_OPTS,
        region_filter=(
            "REGION_TYPE = 'metro' AND STATE_CODE = 'LA' "
            f"AND REGION LIKE '{config.REDFIN_METRO_REGION_PREFIX}%'"
        ),
    )


def _zip_sql() -> str:
    regions = ", ".join(f"'Zip Code: {z}'" for z in config.ZIPS)
    return _SELECT.format(
        geo_level="zip",
        geo_id_expr="regexp_extract(REGION, '\\d{5}', 0)",
        path=config.REDFIN_SOURCES["zip"],
        csv_opts=CSV_OPTS,
        region_filter=f"REGION_TYPE = 'zip code' AND REGION IN ({regions})",
    )


def load(con: duckdb.DuckDBPyConnection, levels: tuple[str, ...] = ("county", "metro", "zip")) -> int:
    parts = {"county": _county_sql, "metro": _metro_sql, "zip": _zip_sql}
    union = "\nUNION ALL BY NAME\n".join(parts[level]() for level in levels)
    con.execute(
        f"""
        CREATE OR REPLACE TABLE redfin_market AS
        SELECT * FROM ({union})
        WHERE period_begin IS NOT NULL AND geo_id IS NOT NULL
        ORDER BY geo_level, geo_id, period_begin
        """
    )
    count = con.execute("SELECT COUNT(*) FROM redfin_market").fetchone()[0]
    by_level = con.execute(
        "SELECT geo_level, COUNT(DISTINCT geo_id), COUNT(*) FROM redfin_market GROUP BY 1 ORDER BY 1"
    ).fetchall()
    detail = ", ".join(f"{lvl}={g} regions/{n} rows" for lvl, g, n in by_level)
    print(f"  redfin_market: {count} rows ({detail})")
    return count


if __name__ == "__main__":
    load(duckdb.connect(str(config.DB_PATH)))
