from backend import queries

COLS = (
    "parcel_id VARCHAR, lat DOUBLE, lng DOUBLE, assessed_val DOUBLE, land_val DOUBLE, bld_val DOUBLE,"
    " zoning VARCHAR, subdivision VARCHAR"
)


def _parcels(con, rows):
    con.execute(f"CREATE TABLE parcel_market ({COLS})")
    con.executemany("INSERT INTO parcel_market VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows)


def _street(n, start_id, zoning="R1A", bld=10000.0, subdivision="BONNABEL PLACE", step=0.0001):
    """n houses ~11 m apart along a street, assessed 20,000 + 1,000 x i."""
    return [
        (f"{start_id + i}", 29.99 + i * step, -90.14, 20000.0 + 1000 * i, 10000.0, bld, zoning, subdivision)
        for i in range(n)
    ]


def test_ranks_against_similar_parcels_only(con):
    houses = _street(12, 100)
    others = [
        # Same block, but a store and a vacant lot: never compared with the houses.
        ("900", 29.9905, -90.14, 900000.0, 50000.0, 850000.0, "C2", "BONNABEL PLACE"),
        ("901", 29.9906, -90.14, 5000.0, 5000.0, 0.0, "R1A", "BONNABEL PLACE"),
    ]
    _parcels(con, houses + others)
    got = queries.assessment_comparisons(con)
    mid = got["106"]  # assessed 26,000: 6 of the other 11 houses are lower
    assert mid["zoning"] == "R1A" and mid["improved"] is True
    assert mid["nearby"]["n"] == 11 and mid["subdivision"]["n"] == 11
    assert mid["nearby"]["below_pct"] == round(6 / 11 * 100)
    assert mid["nearby"]["assessed"][2] == 25000  # median of the other 11: 20k-25k and 27k-31k
    assert mid["subdivision"]["name"] == "BONNABEL PLACE"
    # Too few similar parcels (1 store, 1 vacant lot): no comparison for them.
    assert "900" not in got and "901" not in got


def test_nearby_uses_the_closest_parcels_within_the_radius(con):
    # 60 houses in a line, ~11 m apart: the first house's 50 nearest reach ~555 m, past the
    # 400 m cap, so it compares with the ~36 within 400 m; a house mid-street gets the full 50.
    _parcels(con, _street(60, 1000))
    got = queries.assessment_comparisons(con)
    edge, middle = got["1000"]["nearby"], got["1030"]["nearby"]
    assert edge["reach_m"] <= queries.COMPARE_RADIUS_M and edge["n"] < queries.COMPARE_NEAREST
    assert middle["n"] == queries.COMPARE_NEAREST
    assert middle["reach_m"] < edge["reach_m"]


def test_single_parcel_matches_the_full_run(con):
    _parcels(con, _street(15, 200))
    assert queries.assessment_comparisons(con, "207") == {"207": queries.assessment_comparisons(con)["207"]}
