"""Load Zillow Research ZHVI (home values) and ZORI (rents) for New Orleans–Metairie.

Source is Zillow's public research CSVs (wide format: one row per region, one
column per month). Metro, County and ZIP files are unpivoted into one long table,
``zillow_index``:

    index_name  'zhvi' | 'zori'
    geo_level   'metro' | 'county' | 'zip'
    geo_id      CBSA 35380 | parish FIPS 22051/22071 | 5-digit ZIP
    region_id   Zillow's own RegionID (kept for traceability)
    month, value

Filtering is by name/FIPS rather than Zillow RegionID so a RegionID renumbering
cannot silently drop the market. Set ZILLOW_SOURCE_DIR to a directory holding the
same-named CSVs for offline development.
"""

import duckdb

from . import config

_MONTH_COLS = "COLUMNS('^\\d{4}-\\d{2}-\\d{2}$')"


def _select(index_name: str, geo_level: str, geo_id_expr: str, where: str) -> str:
    path = config.zillow_source(index_name, geo_level)
    return f"""
    SELECT
        '{index_name}' AS index_name,
        '{geo_level}' AS geo_level,
        geo_id,
        region_id,
        region_name,
        CAST(month AS DATE) AS month,
        TRY_CAST(value AS DOUBLE) AS value
    FROM (
        SELECT
            {geo_id_expr} AS geo_id,
            CAST(RegionID AS VARCHAR) AS region_id,
            CAST(RegionName AS VARCHAR) AS region_name,
            {_MONTH_COLS}
        FROM read_csv('{path}', header=true, all_varchar=true, ignore_errors=true)
        WHERE {where}
    )
    UNPIVOT (value FOR month IN ({_MONTH_COLS}))
    WHERE value IS NOT NULL AND value <> ''
    """


def _metro(index_name: str) -> str:
    return _select(
        index_name,
        "metro",
        f"'{config.CBSA_CODE}'",
        f"RegionType = 'msa' AND RegionName = '{config.ZILLOW_METRO_REGION_NAME}'",
    )


def _county(index_name: str) -> str:
    # County files carry StateCodeFIPS + MunicipalCodeFIPS; zero-pad in case the
    # CSV reader stripped leading zeros.
    fips_expr = (
        "lpad(CAST(StateCodeFIPS AS VARCHAR), 2, '0') || lpad(CAST(MunicipalCodeFIPS AS VARCHAR), 3, '0')"
    )
    fips_list = ", ".join(f"'{f}'" for f in config.PARISH_FIPS.values())
    return _select(index_name, "county", fips_expr, f"{fips_expr} IN ({fips_list})")


def _zip(index_name: str) -> str:
    zip_expr = "lpad(CAST(RegionName AS VARCHAR), 5, '0')"
    zips = ", ".join(f"'{z}'" for z in config.ZIPS)
    return _select(index_name, "zip", zip_expr, f"{zip_expr} IN ({zips})")


def load(
    con: duckdb.DuckDBPyConnection,
    indexes: tuple[str, ...] = ("zhvi", "zori"),
    levels: tuple[str, ...] = ("metro", "county", "zip"),
) -> int:
    builders = {"metro": _metro, "county": _county, "zip": _zip}
    union = "\nUNION ALL BY NAME\n".join(builders[lvl](idx) for idx in indexes for lvl in levels)
    con.execute(
        f"""
        CREATE OR REPLACE TABLE zillow_index AS
        SELECT * FROM ({union})
        WHERE value IS NOT NULL
        ORDER BY index_name, geo_level, geo_id, month
        """
    )
    count = con.execute("SELECT COUNT(*) FROM zillow_index").fetchone()[0]
    by = con.execute(
        "SELECT index_name, geo_level, COUNT(DISTINCT geo_id) FROM zillow_index GROUP BY 1, 2 ORDER BY 1, 2"
    ).fetchall()
    print(f"  zillow_index: {count} rows " + ", ".join(f"{i}/{lvl}={n} regions" for i, lvl, n in by))
    return count


if __name__ == "__main__":
    load(duckdb.connect(str(config.DB_PATH)))
