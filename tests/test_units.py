import pytest

from backend import queries


@pytest.mark.parametrize(
    "address, legal, expected",
    [
        ("2600 BELLE CHASSE HWY #203", None, ("2600 BELLE CHASSE HWY", "203")),
        ("1965 BELLE CHASSE HWY UNIT 179", None, ("1965 BELLE CHASSE HWY", "179")),
        ("7015 JEFFERSON HWY STE D", None, ("7015 JEFFERSON HWY", "D")),
        ("600 PORT OF NEW ORLEANS PL 11B", None, ("600 PORT OF NEW ORLEANS PL", "11B")),  # bare unit
        (
            "714 FAIRFAX DR",
            "PARK PLACE CONDO UNIT 122 PLUS AN UNDIV 1.9346% INTEREST",
            ("714 FAIRFAX DR", "122"),
        ),
        ("4910 WABASH ST", "SEC B CONDO UN 4910 PLUS UNDIV 1/6 INT", ("4910 WABASH ST", "4910")),
        (
            "3609 MARTINIQUE AVE",
            "ANTILLES I CONDO SUITE 3609-A IN THE COMMON",
            ("3609 MARTINIQUE AVE", "3609-A"),
        ),
        # Not units: a lettered street, a subdivision phase, a surname containing "CONDO", plain houses.
        ("100 AVE A", None, ("100 AVE A", None)),
        ("1 COLONIAL CLUB DR", "LOT 5 COLONIAL CLUB UNIT 3", ("1 COLONIAL CLUB DR", None)),
        ("1808 CONDON AVE", "TAX SALE IN THE NAME OF CONDON UNIT 5", ("1808 CONDON AVE", None)),
        ("100 N 7TH ST", None, ("100 N 7TH ST", None)),
        ("321  bonnabel blvd ", "LOT 10 SQ 15 BONNABEL PL", ("321 BONNABEL BLVD", None)),
    ],
)
def test_split_unit(address, legal, expected):
    assert queries.split_unit(address, legal) == expected


def test_unit_address():
    full = "714 Fairfax Dr, Gretna, LA 70056"
    assert queries.unit_address(full, "122") == "714 Fairfax Dr Unit 122, Gretna, LA 70056"
    assert queries.unit_address("714 Fairfax Dr", "122") == "714 Fairfax Dr Unit 122"


def test_parcel_query_accepts_lettered_sub_parcels():
    assert queries.parcel_query("Parcel 0820008042A") == "0820008042A"
    assert queries.parcel_query("0820008042b") == "0820008042B"
    assert queries.parcel_query("714 Fairfax Dr") is None
