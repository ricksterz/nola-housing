import duckdb

from backend import queries
from etl import load_flood, refresh_flood
from etl.assessor.http import RobotsDisallowed


def _mock_downstream(monkeypatch):
    """Skip the carry-over, join rebuild and compact: the DB here is minimal."""
    monkeypatch.setattr(load_flood, "carry_over_by_lot", lambda con: 0)
    monkeypatch.setattr(refresh_flood.build_join, "build", lambda con: None)
    monkeypatch.setattr(refresh_flood.db_compact, "compact", lambda con, path: None)


def _status(path):
    con = duckdb.connect(str(path))
    row = con.execute("SELECT status, detail FROM source_status WHERE source = 'flood'").fetchone()
    con.close()
    return row


def test_blocked_refresh_records_blocked_status(tmp_path, monkeypatch):
    _mock_downstream(monkeypatch)

    def blocked(*args, **kwargs):
        raise RobotsDisallowed("https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer")

    monkeypatch.setattr(load_flood, "load", blocked)
    refresh_flood.main(["--db", str(tmp_path / "db.duckdb")])
    status, detail = _status(tmp_path / "db.duckdb")
    assert status == "blocked"
    assert "robots.txt" in detail


def test_failed_refresh_records_error_status(tmp_path, monkeypatch):
    _mock_downstream(monkeypatch)

    def broken(*args, **kwargs):
        raise RuntimeError("NFHL returned no flood zones for orleans")

    monkeypatch.setattr(load_flood, "load", broken)
    refresh_flood.main(["--db", str(tmp_path / "db.duckdb")])
    status, detail = _status(tmp_path / "db.duckdb")
    assert status == "error"
    assert "RuntimeError" in detail


def test_successful_refresh_records_ok_status(tmp_path, monkeypatch):
    _mock_downstream(monkeypatch)
    monkeypatch.setattr(load_flood, "load", lambda *args, **kwargs: {"jefferson": 10, "orleans": 20})
    refresh_flood.main(["--db", str(tmp_path / "db.duckdb")])
    status, detail = _status(tmp_path / "db.duckdb")
    assert status == "ok"
    assert detail == "30 parcels zoned"


def test_record_source_status_upserts(con):
    load_flood.record_source_status(con, "flood", "blocked", "robots.txt")
    load_flood.record_source_status(con, "flood", "ok", "30 parcels zoned")
    rows = con.execute("SELECT status, detail FROM source_status WHERE source = 'flood'").fetchall()
    assert rows == [("ok", "30 parcels zoned")]


def test_meta_includes_flood_status(con):
    load_flood.record_source_status(con, "flood", "blocked", "robots.txt disallows /arcgis")
    meta = queries.meta(con)
    assert meta["sources"]["flood"]["status"] == "blocked"
    assert meta["sources"]["flood"]["status_detail"] == "robots.txt disallows /arcgis"
    # Old databases without the table report no status rather than failing.
    con.execute("DROP TABLE source_status")
    meta = queries.meta(con)
    assert meta["sources"]["flood"]["status"] is None
    assert meta["sources"]["flood"]["status_detail"] is None
