from etl import build_join, config, load_assessor, load_fred, load_redfin, load_zillow
from etl.assessor.http import PoliteSession
from tests.conftest import FakeResponse


def _load_all(con, fx, fake_http, monkeypatch):
    load_redfin.load(con)
    load_zillow.load(con)
    load_fred.load(con)
    layer = (fx / "assessor" / "arcgis_layer.json").read_text()
    query = (fx / "assessor" / "arcgis_query.json").read_text()

    def handler(url, params):
        if url.endswith("/query"):
            return FakeResponse(
                url, 200, '{"count": 2}' if params.get("returnCountOnly") else query, "application/json"
            )
        return FakeResponse(url, 200, layer, "application/json")

    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["jefferson"],
        "bulk_candidates",
        [{"kind": "arcgis", "url": "https://gis.test/Parcels/MapServer/0"}],
    )
    s = PoliteSession(session=fake_http({"https://gis.test/": handler}), min_interval=0, sleep=lambda _: None)
    load_assessor.load(con, parishes=("jefferson",), session=s, tax_year=2026)
    build_join.build(con)


def test_geo_dim(con):
    build_join.build(con)  # works with no source data at all
    levels = dict(con.execute("SELECT geo_level, COUNT(*) FROM geo_dim GROUP BY 1").fetchall())
    assert levels == {"metro": 1, "county": 2, "zip": len(config.ZIPS)}
    assert con.execute("SELECT parish_fips, cbsa FROM geo_dim WHERE geo_id='70005'").fetchone() == (
        "22051",
        "35380",
    )
    assert con.execute("SELECT parish_fips FROM geo_dim WHERE geo_id='70118'").fetchone() == ("22071",)
    assert con.execute("SELECT COUNT(*) FROM parcel_market").fetchone()[0] == 0


def test_market_monthly_aligns_sources(
    con, fx, fake_http, redfin_fixtures, zillow_fixtures, fred_fixture_get, monkeypatch
):
    _load_all(con, fx, fake_http, monkeypatch)
    row = con.execute(
        """SELECT redfin_median_sale_price, zhvi, zori, parish_fips, cbsa FROM market_monthly
           WHERE geo_level='zip' AND geo_id='70005' AND month='2026-03-01'"""
    ).fetchone()
    assert row == (650000.0, 618000.0, 2130.0, "22051", "35380")
    # metro and county rows carry their own keys
    assert (
        con.execute(
            "SELECT zhvi FROM market_monthly WHERE geo_level='metro' AND geo_id='35380' "
            "AND month='2026-03-01'"
        ).fetchone()[0]
        == 285200.0
    )
    assert (
        con.execute(
            "SELECT redfin_homes_sold FROM market_monthly WHERE geo_level='county' AND geo_id='22071' "
            "AND month='2026-03-01'"
        ).fetchone()[0]
        == 410.0
    )


def test_macro_index(con, fred_fixture_get):
    load_fred.load(con)
    build_join.build(con)
    row = con.execute("SELECT mortgage_rate_30yr FROM macro_index WHERE date='2026-09-10'").fetchone()
    assert row == (6.22,)
    assert con.execute(
        "SELECT jefferson_hpi, orleans_hpi FROM macro_index WHERE date='2024-01-01'"
    ).fetchone() == (284.2, 402.5)


def test_parcel_market_joins_all_four_sources(
    con, fx, fake_http, redfin_fixtures, zillow_fixtures, fred_fixture_get, monkeypatch
):
    _load_all(con, fx, fake_http, monkeypatch)
    cols = [c[0] for c in con.execute("DESCRIBE parcel_market").fetchall()]
    row = con.execute("SELECT * FROM parcel_market WHERE parcel_id='0520001234'").fetchone()
    rec = dict(zip(cols, row, strict=True))
    assert rec["parish_fips"] == "22051" and rec["cbsa"] == "35380" and rec["zip_code"] == "70005"
    assert rec["site_address_norm"] == "123 METAIRIE RD"
    assert rec["lat"] and rec["lng"]
    assert rec["assessed_val"] == 57500.0 and rec["tot_mkt_val"] == 575000.0
    assert rec["assessed_value_history"][0]["tax_year"] == 2026
    # latest ZIP market comps
    assert rec["market_as_of"].isoformat() == "2026-03-01"
    assert rec["redfin_median_sale_price"] == 650000.0 and rec["zhvi"] == 618000.0 and rec["zori"] == 2130.0
    assert rec["redfin_months_supply"] == 4.0
    # macro: parish + metro HPI and mortgage rate
    assert rec["parish_hpi"] == 289.0 and rec["parish_hpi_date"].isoformat() == "2025-01-01"
    assert rec["metro_hpi"] == 322.9 and rec["mortgage_rate_30yr"] == 6.22
    # parcel in 70001 has no matching ZIP zillow/redfin? 70001 has both -> present
    other = con.execute(
        "SELECT zhvi, redfin_median_sale_price FROM parcel_market WHERE parcel_id='0520009999'"
    ).fetchone()
    assert other == (307000.0, 330000.0)


def test_houston_compat_views(
    con, fx, fake_http, redfin_fixtures, zillow_fixtures, fred_fixture_get, monkeypatch
):
    _load_all(con, fx, fake_http, monkeypatch)
    # The Houston comps app's queries, verbatim shapes:
    acct = con.execute(
        "SELECT acct, tot_mkt_val, building_area FROM hcad_accounts WHERE site_address_norm = ?",
        ["123 METAIRIE RD"],
    ).fetchone()
    assert acct == ("0520001234", 575000.0, None)
    assert con.execute(
        "SELECT zhvi FROM zhvi_trend WHERE zip_code = ? ORDER BY month DESC LIMIT 1", ["70005"]
    ).fetchone() == (618000.0,)
    assert con.execute(
        "SELECT median_sale_price, active_listings, months_of_supply FROM redfin_market_zip "
        "WHERE zip_code = ? ORDER BY period_begin DESC LIMIT 1",
        ["70005"],
    ).fetchone() == (650000.0, 60.0, 4.0)
    assert con.execute("SELECT COUNT(*) FROM zori_trend").fetchone()[0] == 5
