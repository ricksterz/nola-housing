import json

import pytest

from etl import config, load_assessor
from etl.assessor import JeffersonAdapter
from etl.assessor.http import PoliteSession
from etl.assessor.search_ui import Checkpoint, load_seed_ids, pull_parcels
from tests.conftest import FakeResponse


def _detail_routes(fx):
    ok = (fx / "assessor" / "jefferson_detail.html").read_text()
    nf = (fx / "assessor" / "not_found.html").read_text()

    def handler(url, params):
        if "0520001234" in url:
            return FakeResponse(url, 200, ok)
        if "0520005555" in url:
            return FakeResponse(url, 200, nf)
        if "0520000404" in url:
            return FakeResponse(url, 404, "")
        return FakeResponse(url, 500, "boom")

    return {"https://www.jpassessor.net/": handler}


def test_load_seed_ids(fx):
    ids = load_seed_ids(
        "jefferson", seed_file=str(fx / "assessor" / "seeds.csv"), existing=["0520001234", "X1"]
    )
    assert ids == ["0520001234", "0520005555", "X1"]
    assert load_seed_ids("orleans", seed_file=str(fx / "assessor" / "seeds.csv")) == ["512345678"]


def test_pull_parcels_checkpoints_and_resumes(fx, fake_http, tmp_path):
    fake = fake_http(_detail_routes(fx))
    s = PoliteSession(session=fake, min_interval=0, sleep=lambda _: None, max_retries=0)
    got = []
    adapter = JeffersonAdapter("https://www.jpassessor.net/p?parcel={parcel_id}")
    stats = pull_parcels(
        adapter,
        ["0520001234", "0520005555", "0520000404", "0520000500"],
        s,
        tmp_path,
        lambda rec, url: got.append((rec.parcel_id, url)),
    )
    assert stats.parsed == 1 and stats.not_found == 2 and stats.errors == 1 and stats.stopped_reason is None
    assert got[0][0] == "0520001234"
    cp = json.loads((tmp_path / "jefferson" / "checkpoint.json").read_text())["done"]
    assert cp["0520001234"] == "parsed" and cp["0520005555"] == "not_found" and cp["0520000500"] == "http 500"

    # Resume: parsed/not_found are skipped, the error is retried.
    fake.calls.clear()
    stats2 = pull_parcels(
        adapter,
        ["0520001234", "0520005555", "0520000500"],
        s,
        tmp_path,
        lambda rec, url: got.append(rec.parcel_id),
    )
    assert stats2.attempted == 1
    assert all("0520000500" in u for u, _ in fake.calls if "robots" not in u)


def test_pull_parcels_stops_on_budget(fx, fake_http, tmp_path):
    fake = fake_http(_detail_routes(fx))
    s = PoliteSession(session=fake, min_interval=0, sleep=lambda _: None, max_requests=2)
    adapter = JeffersonAdapter("https://www.jpassessor.net/p?parcel={parcel_id}")
    stats = pull_parcels(
        adapter,
        ["0520001234", "0520001234x", "0520001234y"],
        s,
        tmp_path,
        lambda rec, url: None,
        checkpoint=Checkpoint(tmp_path / "cp.json"),
    )
    assert stats.parsed == 2 and "budget" in stats.stopped_reason


def test_pull_parcels_stops_when_robots_disallows(fx, fake_http, tmp_path):
    fake = fake_http(_detail_routes(fx), robots="User-agent: *\nDisallow: /\n")
    s = PoliteSession(session=fake, min_interval=0, sleep=lambda _: None)
    adapter = JeffersonAdapter("https://www.jpassessor.net/p?parcel={parcel_id}")
    stats = pull_parcels(adapter, ["0520001234"], s, tmp_path, lambda rec, url: None)
    assert stats.parsed == 0 and "robots" in stats.stopped_reason


def _arcgis_routes(fx):
    layer = (fx / "assessor" / "arcgis_layer.json").read_text()
    query = (fx / "assessor" / "arcgis_query.json").read_text()
    count = (fx / "assessor" / "arcgis_count.json").read_text()

    def handler(url, params):
        if url.endswith("/query"):
            return FakeResponse(
                url, 200, count if params.get("returnCountOnly") else query, "application/json"
            )
        return FakeResponse(url, 200, layer, "application/json")

    return {"https://gis.test/Parcels/MapServer/0": handler}


def test_load_parish_prefers_bulk(con, fx, fake_http, raw_dir, monkeypatch):
    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["jefferson"],
        "bulk_candidates",
        [{"kind": "arcgis", "url": "https://gis.test/Parcels/MapServer/0"}],
    )
    s = PoliteSession(session=fake_http(_arcgis_routes(fx)), min_interval=0, sleep=lambda _: None)
    summary = load_assessor.load_parish(con, "jefferson", session=s, tax_year=2026)
    assert summary["source"] == "bulk:arcgis" and summary["records"] == 2
    assert (
        con.execute("SELECT COUNT(*) FROM assessor_parcels_raw WHERE parish='jefferson'").fetchone()[0] == 2
    )
    assert con.execute("SELECT ok FROM assessor_bulk_probes").fetchone()[0] is True
    lat, lng = con.execute(
        "SELECT lat, lng FROM assessor_parcels_raw WHERE parcel_id='0520001234'"
    ).fetchone()
    assert lat and lng
    # Re-load replaces the bulk snapshot instead of duplicating it.
    load_assessor.load_parish(con, "jefferson", session=s, tax_year=2026)
    assert con.execute("SELECT COUNT(*) FROM assessor_parcels_raw").fetchone()[0] == 2


def test_load_parish_falls_back_to_search_ui(con, fx, fake_http, raw_dir, monkeypatch):
    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["jefferson"],
        "bulk_candidates",
        [{"kind": "arcgis", "url": "https://gis.test/missing"}],
    )
    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["jefferson"]["search_ui"],
        "detail_url",
        "https://www.jpassessor.net/p?parcel={parcel_id}",
    )
    s = PoliteSession(
        session=fake_http(_detail_routes(fx)), min_interval=0, sleep=lambda _: None, max_retries=0
    )
    summary = load_assessor.load_parish(
        con, "jefferson", session=s, tax_year=2026, seed_file=str(fx / "assessor" / "seeds.csv")
    )
    assert summary["source"] == "search_ui" and summary["records"] == 1
    assert con.execute("SELECT ok FROM assessor_bulk_probes").fetchone()[0] is False
    row = con.execute(
        "SELECT owner_name, assessed_val, tax_year, source_kind FROM assessor_parcels_raw"
    ).fetchone()
    assert row == ("DOE, JANE & JOHN", 57500.0, 2026, "search_ui")
    assert (raw_dir / "jefferson" / "detail_0520001234.html").exists()
    assert (raw_dir / "jefferson" / "checkpoint_2026.json").exists()


def test_load_parish_without_seeds_is_a_noop(con, fake_http, raw_dir, monkeypatch):
    monkeypatch.setattr(config, "ASSESSOR_SEED_FILE", None)
    s = PoliteSession(session=fake_http(), min_interval=0, sleep=lambda _: None)
    summary = load_assessor.load_parish(con, "jefferson", session=s, force_search_ui=True)
    assert summary["records"] == 0 and summary.get("note") == "no seeds"


def test_orleans_never_falls_back_to_scraping(con, fake_http, raw_dir, monkeypatch):
    # nolaassessor.com is behind a bot challenge: with no bulk source, Orleans pulls nothing and
    # makes no request to the Assessor's site at all.
    fake = fake_http()
    s = PoliteSession(session=fake, min_interval=0, sleep=lambda _: None)
    summary = load_assessor.load_parish(con, "orleans", session=s, force_search_ui=True, seed_file=None)
    assert summary["records"] == 0 and "search UI disabled" in summary["note"]
    assert not [u for u, _ in fake.calls if "nolaassessor" in u]


def test_short_bulk_pull_keeps_the_previous_load(con, fx, fake_http, raw_dir, monkeypatch):
    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["jefferson"],
        "bulk_candidates",
        [{"kind": "arcgis", "url": "https://gis.test/Parcels/MapServer/0"}],
    )
    s = PoliteSession(session=fake_http(_arcgis_routes(fx)), min_interval=0, sleep=lambda _: None)
    load_assessor.load_parish(con, "jefferson", session=s, tax_year=2026)
    before = con.execute("SELECT COUNT(*) FROM assessor_parcels_raw").fetchone()[0]
    # Same layer, but now it claims 100 records while serving the same 2: a failed pull.
    routes = _arcgis_routes(fx)
    count_route = "https://gis.test/Parcels/MapServer/0"
    base = routes[count_route]

    def claims_more(url, params):
        if params and params.get("returnCountOnly"):
            return FakeResponse(url, 200, '{"count": 100}', "application/json")
        return base(url, params)

    s2 = PoliteSession(session=fake_http({count_route: claims_more}), min_interval=0, sleep=lambda _: None)
    with pytest.raises(RuntimeError, match="read 2 of 100 features"):
        load_assessor.load_parish(con, "jefferson", session=s2, tax_year=2026)
    assert con.execute("SELECT COUNT(*) FROM assessor_parcels_raw").fetchone()[0] == before


def test_build_derived_latest_and_history(con):
    load_assessor.ensure_tables(con)
    cols = ", ".join(load_assessor.RAW_COLUMNS)
    base = {c: None for c in load_assessor.RAW_COLUMNS}
    rows = [
        {
            **base,
            "parish": "orleans",
            "parish_fips": "22071",
            "parcel_id": "1",
            "assessed_val": 39000,
            "tax_year": 2025,
            "fetched_at": "2025-08-01 00:00:00",
            "source_kind": "search_ui",
            "payload": "{}",
        },
        {
            **base,
            "parish": "orleans",
            "parish_fips": "22071",
            "parcel_id": "1",
            "assessed_val": 40500,
            "tax_year": 2026,
            "fetched_at": "2026-07-16 00:00:00",
            "source_kind": "search_ui",
            "payload": "{}",
        },
        {
            **base,
            "parish": "orleans",
            "parish_fips": "22071",
            "parcel_id": "1",
            "assessed_val": 41000,
            "tax_year": 2026,
            "fetched_at": "2026-08-20 00:00:00",
            "source_kind": "search_ui",
            "payload": "{}",
        },
    ]
    for r in rows:
        con.execute(
            f"INSERT INTO assessor_parcels_raw ({cols}) VALUES ({', '.join('?' * len(r))})", list(r.values())
        )
    load_assessor.build_derived(con)
    assert con.execute("SELECT assessed_val FROM assessor_parcels").fetchall() == [(41000.0,)]
    hist = con.execute("SELECT tax_year, assessed_val FROM assessed_value_history ORDER BY 1").fetchall()
    assert hist == [(2025, 39000.0), (2026, 41000.0)]  # post-window pull supersedes the open-roll one


def test_search_ui_resume_is_database_backed(con, fx, fake_http, raw_dir, monkeypatch, tmp_path):
    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["jefferson"]["search_ui"],
        "detail_url",
        "https://www.jpassessor.net/p?parcel={parcel_id}",
    )
    fake = fake_http(_detail_routes(fx))
    s = PoliteSession(session=fake, min_interval=0, sleep=lambda _: None, max_retries=0)
    seeds = str(fx / "assessor" / "seeds.csv")
    load_assessor.load_parish(
        con, "jefferson", session=s, tax_year=2026, seed_file=seeds, force_search_ui=True
    )
    # Simulate a fresh runner: raw dir (and its checkpoint) gone, database kept.
    monkeypatch.setattr(config, "RAW_DIR", tmp_path / "fresh")
    fake.calls.clear()
    summary = load_assessor.load_parish(
        con, "jefferson", session=s, tax_year=2026, seed_file=seeds, force_search_ui=True
    )
    pulled = [u for u, _ in fake.calls if "0520001234" in u]
    assert pulled == [] and summary["records"] == 0
    # A new roll year pulls again; the page's own "Tax Year" label (2026) wins over
    # the CLI tag, so the row replaces the 2026 record instead of creating 2027.
    summary = load_assessor.load_parish(
        con, "jefferson", session=s, tax_year=2027, seed_file=seeds, force_search_ui=True
    )
    assert summary["records"] == 1
    load_assessor.build_derived(con)
    assert con.execute("SELECT tax_year FROM assessed_value_history ORDER BY 1").fetchall() == [(2026,)]
    assert con.execute("SELECT COUNT(*) FROM assessor_parcels_raw").fetchone()[0] == 1


# ---------------------------------------------------------------------------
# Orleans: ParcelSearch first, data.nola.gov Parcels as a fallback-only source
# ---------------------------------------------------------------------------
ARC = "https://gis.test/ParcelSearch/MapServer/0"
SODA_META = "https://data.test/api/views/abcd-1234.json"
SODA_ROWS = "https://data.test/resource/abcd-1234.json"
ARC_LAYER = json.dumps(
    {"fields": [{"name": n} for n in ("PARCELID", "SITEADDRESS", "OWNERNME1", "OWNERNME2", "TAXBILLID")]}
)
ARC_ROWS = json.dumps(
    {
        "features": [
            {
                "attributes": {
                    "PARCELID": "41033176",
                    "SITEADDRESS": "624 S ALEXANDER ST, LA, 70119",
                    "OWNERNME1": "GRUNEWALD GEORGE II",
                    "OWNERNME2": None,
                    "TAXBILLID": "105306710",
                },
                "geometry": {"x": -90.1, "y": 29.97},
            }
        ]
    }
)
SQUARE = [[[-90.1, 29.97], [-90.1, 29.98], [-90.09, 29.98], [-90.09, 29.97], [-90.1, 29.97]]]
SODA_COLUMNS = json.dumps(
    {
        "columns": [
            {"fieldName": n, "dataTypeName": "text"}
            for n in ("geopin", "situs_number", "situs_dir", "situs_street", "situs_type")
        ]
        + [{"fieldName": "the_geom", "dataTypeName": "multipolygon"}]
    }
)
SODA_DATA = json.dumps(
    [
        {
            "geopin": "41033176",
            "situs_number": "624",
            "situs_dir": "S",
            "situs_street": "ALEXANDER",
            "situs_type": "ST",
            "the_geom": {"type": "MultiPolygon", "coordinates": [SQUARE]},
        },
        {
            "geopin": "41033177",
            "situs_street": "ALEXANDER",
            "the_geom": {"type": "MultiPolygon", "coordinates": [SQUARE]},
        },
    ]
)


def _orleans_routes(arcgis_up: bool):
    def arc(url, params):
        if not url.endswith("/query"):
            return FakeResponse(url, 200, ARC_LAYER, "application/json")
        if not arcgis_up:  # the outage: metadata answers, every query fails
            return FakeResponse(url, 200, '{"error": {"code": 400, "message": "Failed to execute query."}}')
        if params.get("returnCountOnly"):
            return FakeResponse(url, 200, '{"count": 1}', "application/json")
        return FakeResponse(url, 200, ARC_ROWS, "application/json")

    def soda(url, params):
        if params and params.get("$select") == "count(*)":
            return FakeResponse(url, 200, '[{"count": "2"}]', "application/json")
        return FakeResponse(url, 200, SODA_DATA, "application/json")

    return {
        ARC: arc,
        SODA_META: lambda url, params: FakeResponse(url, 200, SODA_COLUMNS, "application/json"),
        SODA_ROWS: soda,
    }


def _orleans(con, fake_http, monkeypatch, arcgis_up):
    monkeypatch.setitem(
        config.ASSESSOR_SOURCES["orleans"],
        "bulk_candidates",
        [
            {"kind": "arcgis", "url": ARC},
            {"kind": "socrata", "domain": "data.test", "dataset_id": "abcd-1234", "fallback_only": True},
        ],
    )
    fake = fake_http(_orleans_routes(arcgis_up))
    s = PoliteSession(session=fake, min_interval=0, sleep=lambda _: None)
    return load_assessor.load_parish(con, "orleans", session=s, tax_year=2026), fake


def test_orleans_falls_back_to_open_data_parcels_then_upgrades(con, fake_http, raw_dir, monkeypatch):
    summary, fake = _orleans(con, fake_http, monkeypatch, arcgis_up=False)
    assert summary == {"parish": "orleans", "source": "bulk:socrata", "records": 2}
    rows = con.execute(
        "SELECT parcel_id, site_address, owner_name, lat FROM assessor_parcels_raw ORDER BY parcel_id"
    ).fetchall()
    assert rows[0][:3] == ("41033176", "624 S ALEXANDER ST", None) and abs(rows[0][3] - 29.975) < 1e-6
    assert rows[1][1] is None  # no house number: no site address, reachable by parcel number
    assert '"$order": ":id"' in json.dumps([p for u, p in fake.calls if u == SODA_ROWS])
    payload = con.execute("SELECT payload FROM assessor_parcels_raw LIMIT 1").fetchone()[0]
    assert "the_geom" not in payload and "coordinates" not in payload  # no polygons stored

    # ParcelSearch recovers: its load replaces the fallback rows outright.
    summary, _ = _orleans(con, fake_http, monkeypatch, arcgis_up=True)
    assert summary["source"] == "bulk:arcgis"
    assert con.execute(
        "SELECT source_kind, owner_name, tax_bill_number FROM assessor_parcels_raw"
    ).fetchall() == [("bulk:arcgis", "GRUNEWALD GEORGE II", "105306710")]


def test_fallback_never_replaces_a_fuller_load(con, fake_http, raw_dir, monkeypatch):
    _orleans(con, fake_http, monkeypatch, arcgis_up=True)
    with pytest.raises(RuntimeError, match="every bulk pull failed"):
        _orleans(con, fake_http, monkeypatch, arcgis_up=False)
    assert con.execute("SELECT source_kind, owner_name FROM assessor_parcels_raw").fetchall() == [
        ("bulk:arcgis", "GRUNEWALD GEORGE II")
    ]
