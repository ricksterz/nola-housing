import json
from datetime import date

from etl import check_staleness

TODAY = date(2026, 11, 16)


def _fresh_meta():
    return {
        "sources": {
            "redfin": {"latest_period": "2026-10-01"},
            "zillow": {"latest_month": "2026-10-31"},
            "fred": {"fetched_at": "2026-11-14T00:00:00"},
            "flood": {"pulled_at": "2026-11-01T00:00:00"},
            "assessor": {
                "fetched_by_parish": {
                    "orleans": "2026-11-14T00:00:00",
                    "jefferson": "2026-09-01T00:00:00",
                }
            },
            "costs": {"flood_pulled_at": "2026-10-01T00:00:00", "tax_acs_year": 2025},
        }
    }


def test_all_fresh_returns_no_problems():
    assert check_staleness.check(_fresh_meta(), TODAY) == []


def test_redfin_stale_is_flagged():
    meta = _fresh_meta()
    meta["sources"]["redfin"]["latest_period"] = "2026-05-01"
    problems = check_staleness.check(meta, TODAY)
    assert len(problems) == 1
    assert problems[0].startswith("redfin: 2026-05-01 is 199 days old (threshold 180)")


def test_missing_source_is_flagged():
    meta = _fresh_meta()
    del meta["sources"]["zillow"]
    problems = check_staleness.check(meta, TODAY)
    assert problems == ["zillow: no date in meta.json (zillow.latest_month)"]


def test_flood_stale_includes_blocked_status():
    meta = _fresh_meta()
    meta["sources"]["flood"]["pulled_at"] = "2026-08-10T00:00:00"  # 98 days old
    meta["sources"]["flood"]["status"] = "blocked"
    meta["sources"]["flood"]["status_detail"] = "hazards.fema.gov robots.txt disallows /arcgis"
    problems = check_staleness.check(meta, TODAY)
    assert len(problems) == 1
    assert "98 days old" in problems[0]
    assert "(status: blocked: hazards.fema.gov robots.txt disallows /arcgis)" in problems[0]


def test_assessor_orleans_threshold_is_21_days():
    meta = _fresh_meta()
    meta["sources"]["assessor"]["fetched_by_parish"]["orleans"] = "2026-10-25T00:00:00"  # 22 days
    problems = check_staleness.check(meta, TODAY)
    assert len(problems) == 1
    assert problems[0].startswith("assessor-orleans: 2026-10-25 is 22 days old")
    # Jefferson pulls annually: the same age is fine there.
    meta = _fresh_meta()
    meta["sources"]["assessor"]["fetched_by_parish"]["jefferson"] = "2026-10-25T00:00:00"
    assert check_staleness.check(meta, TODAY) == []


def test_tax_year_stale_is_flagged():
    meta = _fresh_meta()
    meta["sources"]["costs"]["tax_acs_year"] = 2023
    problems = check_staleness.check(meta, TODAY)
    assert problems == ["costs-tax: tax year 2023 is 3 years old (threshold 2)"]


def test_main_exit_codes(tmp_path, capsys):
    path = tmp_path / "meta.json"
    path.write_text(json.dumps(_fresh_meta()))
    assert check_staleness.main([str(path)]) == 0
    assert "all sources fresh" in capsys.readouterr().out

    meta = _fresh_meta()
    meta["sources"]["redfin"]["latest_period"] = "2026-05-01"
    path.write_text(json.dumps(meta))
    assert check_staleness.main([str(path)]) == 1
    out = capsys.readouterr().out
    # main() uses the real today, so assert on the stable parts only.
    assert "redfin: 2026-05-01 is" in out and "days old (threshold 180)" in out


def test_db_mode_reads_source_dates_from_the_database(tmp_path, capsys):
    import duckdb

    db = tmp_path / "nola.duckdb"
    con = duckdb.connect(str(db))
    con.execute("CREATE TABLE redfin_market (period_begin DATE)")
    con.execute("INSERT INTO redfin_market VALUES ('2026-05-01')")
    con.close()
    meta = check_staleness.meta_from_db(str(db))
    assert meta["sources"]["redfin"]["latest_period"] == "2026-05-01"
    assert check_staleness.main(["--db", str(db)]) == 1
    out = capsys.readouterr().out
    assert "redfin: 2026-05-01 is" in out
    assert "zillow: no date in meta.json" in out  # a table that isn't there reads as missing


def test_db_mode_with_a_missing_database_fails(tmp_path, capsys):
    assert check_staleness.main(["--db", str(tmp_path / "nope.duckdb")]) == 1
    assert "not found" in capsys.readouterr().out
