import json

from etl import export_schools

FIXTURE = "tests/fixtures/schools/school_finder.html"


def test_slug_matches_school_finder():
    # School Finder's slug(): lowercase, "&" -> " and ", runs of anything else -> "-".
    assert export_schools.slug("St. Catherine of Siena School") == "st-catherine-of-siena-school"
    assert export_schools.slug("Arts & Sciences Academy") == "arts-and-sciences-academy"
    assert export_schools.slug("J.C. Ellis School") == "j-c-ellis-school"


def test_compact_keeps_located_schools_with_their_kind():
    rows = export_schools.compact(export_schools.parse_page(open(FIXTURE).read()))
    by = {r["name"]: r for r in rows}
    assert "Moving Grace Montessori School" not in by  # no location, so never "nearby"
    assert by["St. Catherine of Siena School"]["kind"] == "catholic"
    assert by["St. Catherine of Siena School"]["tuition"] == {"low": 7150, "high": 7875, "year": "2026-27"}
    assert by["J.C. Ellis School"]["kind"] == "public"
    assert by["J.C. Ellis School"]["admission"] == "zoned"
    assert by["J.C. Ellis School"]["charter"] is False
    assert by["Morris Jeff Community School"]["charter"] is True
    # An unpublished tuition is unknown, not free, and a blank letter grade is no grade.
    assert by["Arts & Sciences Academy"]["tuition"] is None
    assert by["Arts & Sciences Academy"]["letter_grade"] is None


def test_main_writes_file_from_saved_page(tmp_path, monkeypatch):
    monkeypatch.setenv("SCHOOLS_SOURCE", FIXTURE)
    out = tmp_path / "schools.json"
    assert export_schools.main(out) == 4
    data = json.loads(out.read_text())
    assert data["source"] == export_schools.SCHOOLS_URL
    assert len(data["schools"]) == 4


def test_unreachable_school_finder_skips_without_failing(tmp_path, monkeypatch):
    missing = tmp_path / "nope.html"
    monkeypatch.setenv("SCHOOLS_SOURCE", str(missing))
    out = tmp_path / "schools.json"
    assert export_schools.main(out) == 0
    assert not out.exists()


def test_page_without_school_list_is_an_error():
    try:
        export_schools.parse_page("<html><body>maintenance</body></html>")
    except ValueError:
        return
    raise AssertionError("expected ValueError")
