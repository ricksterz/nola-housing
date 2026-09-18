from etl import load_zillow


def test_zillow_all_levels(con, zillow_fixtures):
    load_zillow.load(con)
    by = {
        (i, lvl): n
        for i, lvl, n in con.execute(
            "SELECT index_name, geo_level, COUNT(*) FROM zillow_index GROUP BY 1,2"
        ).fetchall()
    }
    assert by[("zhvi", "metro")] == 5
    assert by[("zhvi", "county")] == 9  # 5 Jefferson + 4 Orleans (one blank month dropped)
    assert by[("zhvi", "zip")] == 15  # 70005, 70118, 70001 x 5 months; 77008 dropped
    assert by[("zori", "metro")] == 5
    assert by[("zori", "county")] == 5
    assert by[("zori", "zip")] == 5

    assert con.execute("SELECT DISTINCT geo_id FROM zillow_index WHERE geo_level='metro'").fetchall() == [
        ("35380",)
    ]
    counties = con.execute(
        "SELECT DISTINCT geo_id, region_name FROM zillow_index WHERE geo_level='county' ORDER BY 1"
    ).fetchall()
    assert counties == [("22051", "Jefferson Parish"), ("22071", "Orleans Parish")]
    zips = {
        r[0] for r in con.execute("SELECT DISTINCT geo_id FROM zillow_index WHERE geo_level='zip'").fetchall()
    }
    assert zips == {"70001", "70005", "70118"}


def test_zillow_values_and_region_id(con, zillow_fixtures):
    load_zillow.load(con)
    row = con.execute(
        """SELECT region_id, month, value FROM zillow_index
           WHERE index_name='zhvi' AND geo_id='70005' ORDER BY month DESC LIMIT 1"""
    ).fetchone()
    assert row[0] == "72405"
    assert row[1].isoformat() == "2026-03-31"
    assert row[2] == 618000.0
    # Orleans blank month (2026-02-28) is dropped rather than loaded as 0
    assert (
        con.execute(
            "SELECT COUNT(*) FROM zillow_index WHERE geo_id='22071' AND month='2026-02-28'"
        ).fetchone()[0]
        == 0
    )


def test_zillow_subset(con, zillow_fixtures):
    assert load_zillow.load(con, indexes=("zori",), levels=("zip",)) == 5
