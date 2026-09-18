import json

from etl import fred_client, load_fred


def test_fetch_observations_handles_missing_values(fred_fixture_get):
    obs = fred_client.fetch_observations("ATNHPIUS22071A")
    assert obs == [{"date": "2024-01-01", "value": 402.5}, {"date": "2025-01-01", "value": None}]
    assert fred_fixture_get[-1]["observation_start"] == fred_client.FRED_OBSERVATION_START


def test_fetch_observations_paginates(monkeypatch):
    pages = []

    class R:
        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            pass

        def json(self):
            return self.payload

    def fake_get(url, params=None, timeout=None):
        pages.append(params["offset"])
        off = params["offset"]
        obs = [{"date": f"2020-01-0{i + 1}", "value": str(i)} for i in range(off, min(off + 2, 5))]
        return R({"count": 5, "observations": obs})

    monkeypatch.setattr(fred_client.requests, "get", fake_get)
    monkeypatch.setenv("FRED_API_KEY", "k")
    out = fred_client.fetch_observations("X")
    assert [o["value"] for o in out] == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert pages == [0, 2, 4]


def test_load_fred_writes_history_and_snapshot(con, fred_fixture_get):
    series = {
        k: v
        for k, v in load_fred.config.FRED_SERIES.items()
        if v[0] in ("MORTGAGE30US", "ATNHPIUS35380Q", "ATNHPIUS22051A", "ATNHPIUS22071A")
    }
    n = load_fred.load(con, series=series)
    assert n == 3 + 3 + 2 + 2
    keys = con.execute(
        "SELECT series_id, geo_level, geo_id, frequency FROM fred_series GROUP BY ALL ORDER BY 1"
    ).fetchall()
    assert ("ATNHPIUS22051A", "county", "22051", "annual") in keys
    assert ("ATNHPIUS35380Q", "metro", "35380", "quarterly") in keys
    assert ("MORTGAGE30US", "national", "US", "weekly") in keys
    assert (
        con.execute(
            "SELECT value FROM fred_series WHERE series_id='ATNHPIUS22071A' AND date='2025-01-01'"
        ).fetchone()[0]
        is None
    )

    snap = json.loads(con.execute("SELECT snapshot FROM macro_snapshot").fetchone()[0])
    assert snap["mortgage_rate_30yr"]["value"] == 6.22
    assert snap["mortgage_rate_30yr"]["date"] == "2026-09-10"
    assert snap["nola_metro_hpi"]["geo_id"] == "35380"

    # Re-running replaces rather than duplicates.
    assert load_fred.load(con, series=series) == n


def test_load_fred_without_key_keeps_existing(con, monkeypatch):
    monkeypatch.delenv("FRED_API_KEY", raising=False)
    fred_client._cache["data"] = None
    assert load_fred.load(con) == 0
    assert con.execute("SELECT COUNT(*) FROM fred_series").fetchone()[0] == 0


def test_snapshot_reports_per_series_errors(fred_fixture_get):
    fred_client._cache["data"] = None
    snap = fred_client.get_macro_snapshot()
    assert snap["jefferson_hpi"]["value"] == 289.0
    # realtor.com series have no fixture -> captured as error, not raised
    assert snap["nola_median_dom"]["value"] is None
    assert "error" in snap["nola_median_dom"]
