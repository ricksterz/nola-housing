from backend import queries

BONNABEL = [
    [412, "412 BONNABEL BLVD", "412 Bonnabel Blvd, Metairie, LA 70005"],
    [415, "415 BONNABEL BLVD", "415 Bonnabel Blvd, Metairie, LA 70005"],
    [416, "416 BONNABEL BLVD", "416 Bonnabel Blvd, Metairie, LA 70005"],
    [420, "420 BONNABEL BLVD", "420 Bonnabel Blvd, Metairie, LA 70005"],
    [425, "425 BONNABEL BLVD", "425 Bonnabel Blvd, Metairie, LA 70005"],
]


def test_split_house_number():
    assert queries.split_house_number("418 BONNABEL BLVD") == (418, "BONNABEL BLVD")
    assert queries.split_house_number("  1510a  brockenbraugh st ") == (1510, "BROCKENBRAUGH ST")
    assert queries.split_house_number("3300-3302 N CAUSEWAY BLVD") == (3300, "N CAUSEWAY BLVD")
    assert queries.split_house_number("BONNABEL BLVD") is None


def test_closest_on_street_prefers_nearest_then_same_side():
    # 418 is missing: 416 and 420 are both 2 away on the same (even) side; 415 is 3 away.
    got = [a["address"] for a in queries.closest_on_street(BONNABEL, 418)]
    assert got == ["416 BONNABEL BLVD", "420 BONNABEL BLVD", "415 BONNABEL BLVD", "412 BONNABEL BLVD"]
    # 417: 416 is 1 away; 415 (same odd side) and no other number is 2 away.
    assert [a["address"] for a in queries.closest_on_street(BONNABEL, 417, limit=2)] == [
        "416 BONNABEL BLVD",
        "415 BONNABEL BLVD",
    ]


def test_miss_message_mentions_neighbours_only_when_there_are_some():
    assert "Closest on this street" in queries.lookup_miss_message("418 Bonnabel Blvd", True)
    assert "check the spelling" in queries.lookup_miss_message("418 Bonnabel Blvd", False)


def test_parcel_query_needs_seven_or_more_digits():
    assert queries.parcel_query("0820015268") == "0820015268"
    assert queries.parcel_query("Parcel 0820015268") == "0820015268"
    assert queries.parcel_query("parcel #08-2001-5268") == "0820015268"
    assert queries.parcel_query("42000") is None  # a house number
    assert queries.parcel_query("420 Bonnabel") is None


def test_street_index_names_counts_and_cities():
    by_street = {
        "BONNABEL BLVD": BONNABEL,
        "N CAUSEWAY BLVD": [
            [100, "100 N CAUSEWAY BLVD", "100 N Causeway Blvd, Metairie, LA 70001"],
            [101, "101 N CAUSEWAY BLVD", "101 N Causeway Blvd, Jefferson, LA 70121"],
            [102, "102 N CAUSEWAY BLVD", None],
        ],
    }
    rows = queries.street_index(by_street)
    assert rows[0] == ["bonnabel-blvd", "Bonnabel Blvd", 5, "Metairie", "BONNABEL BLVD"]  # busiest first
    assert rows[1] == ["n-causeway-blvd", "N Causeway Blvd", 3, "Jefferson, Metairie", "N CAUSEWAY BLVD"]


def test_suggest_by_parcel_number(con):
    con.execute(
        "CREATE TABLE parcel_market (parcel_id VARCHAR, site_address VARCHAR, site_address_norm VARCHAR,"
        " city VARCHAR, zip_code VARCHAR)"
    )
    con.execute(
        "INSERT INTO parcel_market VALUES"
        " ('0820015268', '321 BONNABEL BLVD', '321 BONNABEL BLVD', 'Metairie', '70005'),"
        " ('0820015269', NULL, NULL, 'Metairie', NULL),"
        " ('9820041015', NULL, NULL, NULL, NULL)"
    )
    got = queries.suggest(con, "0820015")
    assert got == [
        {"address": "0820015268", "full": "Parcel 0820015268 · 321 Bonnabel Blvd, Metairie, LA 70005"},
        {"address": "0820015269", "full": "Parcel 0820015269 · No street address · Metairie"},
    ]
