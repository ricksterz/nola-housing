import json
from datetime import date

import pytest

from etl import config, load_costs
from etl.assessor.http import PoliteSession
from tests.conftest import FakeResponse

SINCE, UNTIL, NOW = date(2025, 9, 24), date(2026, 9, 24), None


def _policy(cost, zone="AE", occupancy=11, term=1, count=1):
    return {
        "policyCost": cost,
        "ratedFloodZone": zone,
        "occupancyType": occupancy,
        "policyTermIndicator": term,
        "policyCount": count,
    }


def test_flood_cost_rows_filters_and_groups():
    policies = (
        [_policy(1000 + i, "AE") for i in range(15)]
        + [_policy(2000 + i, "VE", occupancy=1) for i in range(10)]  # legacy single-family code
        + [_policy(500 + i, "X") for i in range(20)]
        + [_policy(600 + i, "B") for i in range(5)]  # old moderate-risk zone -> not SFHA
        + [
            _policy(9999, occupancy=12),  # 2–4 unit building
            _policy(9999, term=3),  # multi-year term
            _policy(9999, count=4),  # group policy
            _policy(0),  # no cost reported
        ]
    )
    rows = {r[1]: r for r in load_costs.flood_cost_rows("70005", policies, SINCE, UNTIL, NOW)}
    assert rows["sfha"][2] == 25  # 15 AE + 10 VE; the excluded 9999s never count
    assert rows["other"][2] == 25  # 20 X + 5 B
    assert rows["all"][2] == 50
    assert rows["other"][4] == 512  # median of 500..519 plus 600..604
    assert max(r[5] for r in rows.values()) < 9999


def test_small_groups_are_not_published():
    rows = load_costs.flood_cost_rows(
        "70005", [_policy(1000)] * 5 + [_policy(500, "X")] * 30, SINCE, UNTIL, NOW
    )
    assert {r[1] for r in rows} == {"other", "all"}  # 5 SFHA policies is below NFIP_MIN_POLICIES


ACS = {
    "b25090": "GEO_ID|B25090_E001|B25090_M001\n860Z200US70005|6250000|1\n860Z200US70001|3000000|1\n",
    "b25082": "GEO_ID|B25082_E001|B25082_M001\n860Z200US70005|1000000000|1\n860Z200US70001|500000000|1\n",
    "b25103": "GEO_ID|B25103_E001|B25103_M001\n860Z200US70005|2520|1\n860Z200US70001|-666666666|1\n",
    "b25003": "GEO_ID|B25003_E001|B25003_M001|B25003_E002|B25003_M002\n"
    "860Z200US70005|3000|1|2000|1\n860Z200US70001|1500|1|1000|1\n",
}


def _acs_session(fake_http, year=2024):
    def handler(url, params):
        for table, body in ACS.items():
            if f"/{year}/" in url and url.endswith(f"{table}.dat"):
                return FakeResponse(url, 200, body, "text/plain")
        return FakeResponse(url, 404, "not found", "text/html")

    return PoliteSession(
        session=fake_http({"https://www2.census.gov/": handler}), min_interval=0, sleep=lambda _: None
    )


def test_tax_rate_uses_newest_published_vintage(con, fake_http):
    load_costs.ensure_tables(con)
    assert load_costs.load_tax(con, _acs_session(fake_http), today=date(2026, 9, 24)) == 2024  # 2025 404s
    rows = {
        z: (eff, full)
        for z, eff, full in con.execute("SELECT zip, effective_rate, full_rate FROM zip_tax_rate").fetchall()
    }
    assert {z: r[0] for z, r in rows.items()} == {"70005": 0.00625, "70001": 0.006}
    # Homestead backed out: 6.25M / (1B - 75k x 2,000 owner units); 3M / (500M - 75k x 1,000).
    assert rows["70005"][1] == pytest.approx(6_250_000 / 850_000_000)
    assert rows["70001"][1] == pytest.approx(3_000_000 / 425_000_000)
    # Nothing newer than what's stored: no download, rows kept.
    assert load_costs.load_tax(con, _acs_session(fake_http), today=date(2026, 9, 24)) is None
    assert con.execute("SELECT COUNT(*) FROM zip_tax_rate").fetchone()[0] == 2


def test_tax_rows_from_before_full_rate_are_reloaded(con, fake_http):
    # The table as first shipped: no owner_units / full_rate columns.
    con.execute(
        "CREATE TABLE zip_tax_rate (zip VARCHAR, acs_year INTEGER, aggregate_taxes DOUBLE,"
        " aggregate_value DOUBLE, effective_rate DOUBLE, median_tax_paid DOUBLE, pulled_at TIMESTAMP)"
    )
    con.execute("INSERT INTO zip_tax_rate VALUES ('70005', 2024, 1, 100, 0.01, NULL, NULL)")
    load_costs.ensure_tables(con)
    assert load_costs.load_tax(con, _acs_session(fake_http), today=date(2026, 9, 24)) == 2024
    assert con.execute("SELECT COUNT(*) FROM zip_tax_rate WHERE full_rate IS NULL").fetchone()[0] == 0


def test_failed_nfip_fetch_keeps_previous_rows(con, fake_http):
    load_costs.ensure_tables(con)
    good = json.dumps({"FimaNfipPolicies": [_policy(1000 + i) for i in range(25)]})

    def session(status, body):
        return PoliteSession(
            session=fake_http(
                {
                    config.NFIP_POLICIES_URL: lambda url, params: FakeResponse(
                        url, status, body, "application/json"
                    )
                }
            ),
            min_interval=0,
            max_retries=1,
            sleep=lambda _: None,
        )

    load_costs.load_flood_costs(con, session(200, good), today=UNTIL)
    before = con.execute("SELECT COUNT(*) FROM zip_flood_cost").fetchone()[0]
    assert before == len(config.ZIPS) * 2  # sfha + all per ZIP
    load_costs.load(con, session=session(503, "down"))  # logs and moves on; doesn't raise
    assert con.execute("SELECT COUNT(*) FROM zip_flood_cost").fetchone()[0] == before
