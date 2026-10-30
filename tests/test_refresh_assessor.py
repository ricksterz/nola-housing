from datetime import datetime, timedelta, timezone

import duckdb
import pytest

from etl import load_assessor, refresh_assessor


def _db(path, days_old):
    con = duckdb.connect(str(path))
    con.execute(
        "CREATE TABLE assessor_parcels_raw (parish VARCHAR, source_kind VARCHAR, fetched_at TIMESTAMP)"
    )
    if days_old is not None:
        when = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days_old)
        con.execute("INSERT INTO assessor_parcels_raw VALUES ('orleans', 'bulk:arcgis', ?)", [when])
    con.close()


def _source_down(monkeypatch):
    def down(*args, **kwargs):
        raise load_assessor.SourceUnavailable(
            "orleans", "[orleans] every bulk pull failed; keeping the previous load"
        )

    monkeypatch.setattr(load_assessor, "load", down)


def test_a_source_outage_with_recent_data_only_warns(tmp_path, monkeypatch, capsys):
    _db(tmp_path / "db.duckdb", days_old=9)
    _source_down(monkeypatch)
    refresh_assessor.main(["--db", str(tmp_path / "db.duckdb"), "--parish", "orleans"])
    out = capsys.readouterr().out
    assert "::warning::[orleans] every bulk pull failed" in out and "(9 days old)" in out
    assert "Rebuilding join" not in out  # nothing changed, nothing rebuilt


@pytest.mark.parametrize("days_old", [refresh_assessor.STALE_AFTER_DAYS + 1, None])
def test_a_source_outage_with_stale_or_no_data_fails(tmp_path, monkeypatch, days_old):
    _db(tmp_path / "db.duckdb", days_old=days_old)
    _source_down(monkeypatch)
    with pytest.raises(load_assessor.SourceUnavailable):
        refresh_assessor.main(["--db", str(tmp_path / "db.duckdb"), "--parish", "orleans"])
