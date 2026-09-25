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
