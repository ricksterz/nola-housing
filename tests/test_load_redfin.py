from etl import load_redfin


def test_redfin_all_levels(con, redfin_fixtures):
    n = load_redfin.load(con)
    assert n == 9  # 3 county + 2 metro + 4 zip after decoys dropped

    levels = dict(con.execute("SELECT geo_level, COUNT(*) FROM redfin_market GROUP BY 1").fetchall())
    assert levels == {"county": 3, "metro": 2, "zip": 4}

    fips = con.execute(
        "SELECT DISTINCT region_name, geo_id FROM redfin_market WHERE geo_level='county' ORDER BY 1"
    ).fetchall()
    assert fips == [("Jefferson Parish, LA", "22051"), ("Orleans Parish, LA", "22071")]

    assert con.execute("SELECT DISTINCT geo_id FROM redfin_market WHERE geo_level='metro'").fetchall() == [
        ("35380",)
    ]
    zips = {
        r[0]
        for r in con.execute("SELECT DISTINCT geo_id FROM redfin_market WHERE geo_level='zip'").fetchall()
    }
    assert zips == {"70001", "70005", "70118"}
    # decoys: TX zip, non-'All Residential' property types, other states' Jefferson counties
    assert (
        con.execute("SELECT COUNT(*) FROM redfin_market WHERE geo_id IN ('77008','999','998')").fetchone()[0]
        == 0
    )
    assert con.execute("SELECT DISTINCT property_type FROM redfin_market").fetchall() == [
        ("All Residential",)
    ]


def test_redfin_derived_columns(con, redfin_fixtures):
    load_redfin.load(con)
    row = con.execute(
        """SELECT months_of_supply, frequency, sale_to_list_ratio, pct_price_drops, period_begin
           FROM redfin_market WHERE geo_id='70005' AND period_begin='2026-03-01'"""
    ).fetchone()
    # months_of_supply missing -> inventory * (90/30) / homes_sold = 60*3/45
    assert row[0] == 4.0
    assert row[1] == "rolling_3mo"
    assert abs(row[2] - 97.5) < 1e-9
    assert abs(row[3] - 22.0) < 1e-9
    # supplied months_of_supply is kept as-is
    assert (
        con.execute(
            "SELECT months_of_supply FROM redfin_market WHERE geo_level='metro' AND period_begin='2026-03-01'"
        ).fetchone()[0]
        == 3.9
    )


def test_redfin_houston_column_names_present(con, redfin_fixtures):
    load_redfin.load(con)
    cols = {r[0] for r in con.execute("DESCRIBE redfin_market").fetchall()}
    houston = {
        "period_begin",
        "period_end",
        "frequency",
        "homes_sold",
        "median_sale_price",
        "median_dom",
        "sale_to_list_ratio",
        "pct_sold_above_list",
        "new_listings",
        "active_listings",
        "pending_sales",
        "median_new_listing_price",
        "median_sale_price_psf",
        "months_of_supply",
        "pct_off_market_2wk",
    }
    assert houston <= cols
    assert {"geo_level", "geo_id"} <= cols


def test_redfin_single_level(con, redfin_fixtures):
    assert load_redfin.load(con, levels=("zip",)) == 4
