"""Normalize keys and join the four sources into the shared "parcel + market" schema.

Every raw table already carries (geo_level, geo_id). This step adds:

  geo_dim                 one row per ZIP / parish / metro with parent keys, so any
                          table can roll up ZIP -> parish -> CBSA
  market_monthly          Redfin + ZHVI + ZORI aligned on (geo_level, geo_id, month)
  macro_index             FRED series pivoted to a per-date macro frame
  parcel_market           one row per parcel: address, lat/lng, current values,
                          latest ZIP market comps, parish + metro HPI, mortgage rate

and Houston-compatible views so the comps app (which queries ``hcad_accounts``,
``redfin_market`` by ``zip_code`` and ``zhvi_trend``) can point at this database
without code changes:

  hcad_accounts  -> assessor_parcels (renamed to the HCAD column names)
  zhvi_trend     -> ZIP-level ZHVI (zip_code, month, zhvi)
  redfin_market_zip -> ZIP-level Redfin rows with the Houston column set
"""

import duckdb

from . import config


def _table_exists(con, name: str) -> bool:
    return (
        con.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[
            0
        ]
        > 0
    )


def _ensure_empty_sources(con) -> None:
    """Create empty source tables when a leg has not run, so the join is always buildable."""
    if not _table_exists(con, "redfin_market"):
        con.execute(
            """CREATE TABLE redfin_market (geo_level VARCHAR, geo_id VARCHAR, region_name VARCHAR,
               period_begin DATE, period_end DATE, period_duration_days INTEGER, property_type VARCHAR,
               frequency VARCHAR, homes_sold DOUBLE, median_sale_price DOUBLE, median_dom DOUBLE,
               sale_to_list_ratio DOUBLE, pct_sold_above_list DOUBLE, new_listings DOUBLE,
               active_listings DOUBLE, pending_sales DOUBLE, median_new_listing_price DOUBLE,
               median_sale_price_psf DOUBLE, pct_price_drops DOUBLE, months_of_supply DOUBLE,
               pct_off_market_2wk DOUBLE, source_last_updated TIMESTAMP)"""
        )
    if not _table_exists(con, "zillow_index"):
        con.execute(
            """CREATE TABLE zillow_index (index_name VARCHAR, geo_level VARCHAR, geo_id VARCHAR,
               region_id VARCHAR, region_name VARCHAR, month DATE, value DOUBLE)"""
        )
    if not _table_exists(con, "fred_series"):
        con.execute(
            """CREATE TABLE fred_series (series_key VARCHAR, series_id VARCHAR, geo_level VARCHAR,
               geo_id VARCHAR, frequency VARCHAR, date DATE, value DOUBLE, fetched_at TIMESTAMP)"""
        )
    if not _table_exists(con, "assessor_parcels"):
        from .load_assessor import build_derived

        build_derived(con)


def build_geo_dim(con) -> None:
    rows = [("metro", config.CBSA_CODE, config.CBSA_NAME, None, config.CBSA_CODE)]
    for parish, meta in config.PARISHES.items():
        rows.append(("county", meta["fips"], meta["name"], meta["fips"], config.CBSA_CODE))
        for z in config.ZIPS_BY_PARISH[parish]:
            rows.append(("zip", z, f"ZIP {z}", meta["fips"], config.CBSA_CODE))
    con.execute(
        """CREATE OR REPLACE TABLE geo_dim (geo_level VARCHAR, geo_id VARCHAR, name VARCHAR,
           parish_fips VARCHAR, cbsa VARCHAR)"""
    )
    con.executemany("INSERT INTO geo_dim VALUES (?, ?, ?, ?, ?)", rows)


def build_market_monthly(con) -> None:
    con.execute(
        """
        CREATE OR REPLACE TABLE market_monthly AS
        WITH redfin AS (
            SELECT geo_level, geo_id, CAST(date_trunc('month', period_begin) AS DATE) AS month,
                   median_sale_price, homes_sold, median_dom, active_listings, new_listings,
                   pending_sales, months_of_supply, median_sale_price_psf, sale_to_list_ratio,
                   pct_sold_above_list, pct_price_drops, pct_off_market_2wk
            FROM (
                SELECT *, ROW_NUMBER() OVER (
                    PARTITION BY geo_level, geo_id, date_trunc('month', period_begin)
                    ORDER BY period_duration_days DESC, period_end DESC
                ) AS rn
                FROM redfin_market
            ) WHERE rn = 1
        ),
        zhvi AS (
            SELECT geo_level, geo_id, CAST(date_trunc('month', month) AS DATE) AS month, value AS zhvi
            FROM zillow_index WHERE index_name = 'zhvi'
        ),
        zori AS (
            SELECT geo_level, geo_id, CAST(date_trunc('month', month) AS DATE) AS month, value AS zori
            FROM zillow_index WHERE index_name = 'zori'
        ),
        keys AS (
            SELECT geo_level, geo_id, month FROM redfin
            UNION SELECT geo_level, geo_id, month FROM zhvi
            UNION SELECT geo_level, geo_id, month FROM zori
        )
        SELECT k.geo_level, k.geo_id, g.name AS geo_name, g.parish_fips, g.cbsa, k.month,
               r.median_sale_price AS redfin_median_sale_price,
               r.homes_sold AS redfin_homes_sold,
               r.median_dom AS redfin_median_dom,
               r.active_listings AS redfin_active_listings,
               r.new_listings AS redfin_new_listings,
               r.pending_sales AS redfin_pending_sales,
               r.months_of_supply AS redfin_months_supply,
               r.median_sale_price_psf AS redfin_median_sale_price_psf,
               r.sale_to_list_ratio AS redfin_sale_to_list_ratio,
               r.pct_sold_above_list AS redfin_pct_sold_above_list,
               r.pct_price_drops AS redfin_pct_price_drops,
               r.pct_off_market_2wk AS redfin_pct_off_market_2wk,
               z.zhvi, o.zori
        FROM keys k
        LEFT JOIN geo_dim g USING (geo_level, geo_id)
        LEFT JOIN redfin r USING (geo_level, geo_id, month)
        LEFT JOIN zhvi z USING (geo_level, geo_id, month)
        LEFT JOIN zori o USING (geo_level, geo_id, month)
        ORDER BY geo_level, geo_id, month
        """
    )


def build_macro_index(con) -> None:
    con.execute(
        """
        CREATE OR REPLACE TABLE macro_index AS
        SELECT date,
               MAX(value) FILTER (WHERE series_id = 'MORTGAGE30US') AS mortgage_rate_30yr,
               MAX(value) FILTER (WHERE series_id = 'ATNHPIUS35380Q') AS nola_metro_hpi,
               MAX(value) FILTER (WHERE series_id = 'ATNHPIUS22051A') AS jefferson_hpi,
               MAX(value) FILTER (WHERE series_id = 'ATNHPIUS22071A') AS orleans_hpi,
               MAX(value) FILTER (WHERE series_id = 'MEDLISPRI35380') AS nola_median_list_price,
               MAX(value) FILTER (WHERE series_id = 'ACTLISCOU35380') AS nola_active_listings,
               MAX(value) FILTER (WHERE series_id = 'MEDDAYONMAR35380') AS nola_median_dom,
               MAX(value) FILTER (WHERE series_id = 'MEDLISPRIPERSQUFEE35380') AS nola_list_price_sqft
        FROM fred_series
        WHERE value IS NOT NULL
        GROUP BY date
        ORDER BY date
        """
    )


def build_parcel_market(con) -> None:
    con.execute(
        """
        CREATE OR REPLACE TABLE parcel_market AS
        WITH latest_zip AS (
            SELECT * FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY geo_id ORDER BY month DESC) AS rn
                FROM market_monthly WHERE geo_level = 'zip'
                  AND (redfin_median_sale_price IS NOT NULL OR zhvi IS NOT NULL)
            ) WHERE rn = 1
        ),
        latest_series AS (
            SELECT series_id, geo_id, date, value FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY date DESC) AS rn
                FROM fred_series WHERE value IS NOT NULL
            ) WHERE rn = 1
        ),
        county_hpi AS (
            SELECT geo_id AS parish_fips, value AS parish_hpi, date AS parish_hpi_date
            FROM latest_series WHERE series_id IN ('ATNHPIUS22051A', 'ATNHPIUS22071A')
        ),
        metro AS (
            SELECT MAX(value) FILTER (WHERE series_id = 'ATNHPIUS35380Q') AS metro_hpi,
                   MAX(date) FILTER (WHERE series_id = 'ATNHPIUS35380Q') AS metro_hpi_date,
                   MAX(value) FILTER (WHERE series_id = 'MORTGAGE30US') AS mortgage_rate_30yr,
                   MAX(date) FILTER (WHERE series_id = 'MORTGAGE30US') AS mortgage_rate_date
            FROM latest_series
        ),
        history AS (
            SELECT parish, parcel_id,
                   list(struct_pack(tax_year := tax_year, assessed_val := assessed_val,
                                    tot_mkt_val := tot_mkt_val) ORDER BY tax_year) AS assessed_value_history
            FROM assessed_value_history GROUP BY 1, 2
        )
        SELECT p.parish, p.parish_fips, g.cbsa,
               p.parcel_id, p.tax_bill_number,
               p.site_address, p.site_address_norm, p.city, p.zip_code,
               p.lat, p.lng,
               p.owner_name, p.legal_description, p.property_class,
               p.land_area, p.building_area, p.year_built,
               p.tax_year, p.land_val, p.bld_val, p.tot_mkt_val, p.assessed_val,
               p.homestead_exempt_val, p.taxable_val, p.last_sale_date, p.last_sale_price,
               h.assessed_value_history,
               z.month AS market_as_of,
               z.redfin_median_sale_price, z.redfin_homes_sold, z.redfin_median_dom,
               z.redfin_active_listings, z.redfin_months_supply, z.redfin_median_sale_price_psf,
               z.redfin_pct_price_drops, z.zhvi, z.zori,
               CASE WHEN p.building_area > 0 AND z.redfin_median_sale_price_psf IS NOT NULL
                    THEN ROUND(p.building_area * z.redfin_median_sale_price_psf)
                    END AS implied_value_redfin_psf,
               c.parish_hpi, c.parish_hpi_date,
               m.metro_hpi, m.metro_hpi_date, m.mortgage_rate_30yr, m.mortgage_rate_date,
               p.source_kind, p.fetched_at
        FROM assessor_parcels p
        LEFT JOIN geo_dim g ON g.geo_level = 'county' AND g.geo_id = p.parish_fips
        LEFT JOIN latest_zip z ON z.geo_id = p.zip_code
        LEFT JOIN county_hpi c ON c.parish_fips = p.parish_fips
        LEFT JOIN history h ON h.parish = p.parish AND h.parcel_id = p.parcel_id
        CROSS JOIN metro m
        ORDER BY p.parish, p.zip_code, p.site_address_norm
        """
    )


def build_compat_views(con) -> None:
    """Views named/shaped like the Houston tables so the comps app can read this DB as-is."""
    con.execute(
        """
        CREATE OR REPLACE VIEW hcad_accounts AS
        SELECT parcel_id AS acct, site_address, site_address_norm, zip_code, owner_name,
               property_class AS state_class, NULL AS school_dist, subdivision AS neighborhood_code,
               parish AS neighborhood_grp, parish_fips AS market_area_1, city AS market_area_1_dscr,
               year_built AS year_improved, building_area, land_area, land_area / 43560.0 AS acreage,
               land_val, bld_val, NULL::DOUBLE AS x_features_val, assessed_val,
               tot_mkt_val AS tot_appr_val, tot_mkt_val, NULL::DOUBLE AS new_construction_val,
               last_sale_date, NULL AS protested, legal_description, lat, lng, tax_bill_number, parish
        FROM assessor_parcels
        """
    )
    con.execute(
        """
        CREATE OR REPLACE VIEW zhvi_trend AS
        SELECT geo_id AS zip_code, month, value AS zhvi
        FROM zillow_index WHERE index_name = 'zhvi' AND geo_level = 'zip'
        """
    )
    con.execute(
        """
        CREATE OR REPLACE VIEW zori_trend AS
        SELECT geo_id AS zip_code, month, value AS zori
        FROM zillow_index WHERE index_name = 'zori' AND geo_level = 'zip'
        """
    )
    con.execute(
        """
        CREATE OR REPLACE VIEW redfin_market_zip AS
        SELECT period_begin, period_end, geo_id AS zip_code, frequency, homes_sold, median_sale_price,
               median_dom, sale_to_list_ratio, pct_sold_above_list, new_listings, active_listings,
               pending_sales, median_new_listing_price, median_sale_price_psf, months_of_supply,
               pct_off_market_2wk, pct_price_drops
        FROM redfin_market WHERE geo_level = 'zip'
        """
    )


def build(con: duckdb.DuckDBPyConnection) -> None:
    _ensure_empty_sources(con)
    build_geo_dim(con)
    build_market_monthly(con)
    build_macro_index(con)
    build_parcel_market(con)
    build_compat_views(con)
    for t in ("geo_dim", "market_monthly", "macro_index", "parcel_market"):
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n} rows")


if __name__ == "__main__":
    build(duckdb.connect(str(config.DB_PATH)))
