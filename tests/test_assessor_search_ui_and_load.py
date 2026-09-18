import json

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
    summary = load_assessor.load_parish(con, "orleans", session=s, force_search_ui=True)
    assert summary["records"] == 0 and summary.get("note") == "no seeds"


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
