import json

import pytest

from backend import queries
from etl import export_static, load_address_points


@pytest.mark.parametrize(
    "address, expected",
    [
        ("417 South Solomon Street", "417 S SOLOMON ST"),
        ("600 Port of New Orleans Place", "600 PORT OF NEW ORLEANS PL"),
        ("1530 Saint Charles Avenue", "1530 ST CHARLES AVE"),
        ("503 Third Street", "503 3RD ST"),
        ("5724 Louis Prima Drive West", "5724 W LOUIS PRIMA DR"),  # trailing direction moves up front
        ("1800 L. B. Landry Avenue", "1800 L B LANDRY AVE"),
        ("643 South DuprÃ© Street", "643 S DUPRE ST"),  # UTF-8 read as Latin-1, then the accent
        ("3023 Martin Luther King, Jr. Boulevard", "3023 MARTIN LUTHER KING JR BLVD"),
        # Street names made of these words keep them; roll-style addresses pass through.
        ("100 North St", "100 NORTH ST"),
        ("100 Court Street", "100 COURT ST"),
        ("624 S ALEXANDER ST", "624 S ALEXANDER ST"),
        ("", None),
    ],
)
def test_usps_style(address, expected):
    assert queries.usps_style(address) == expected


def test_roll_address_takes_the_unit_off_first():
    assert load_address_points.roll_address("2308 Saint Andrew Street Apt A") == ("2308 ST ANDREW ST", "A")
    assert load_address_points.roll_address("3 Poydras Street Unit 8H") == ("3 POYDRAS ST", "8H")
    assert load_address_points.roll_address("500 Port of New Orleans Place Ste 159") == (
        "500 PORT OF NEW ORLEANS PL",
        "159",
    )
    assert load_address_points.roll_address("3 POYDRAS STREET PENT 12A") == ("3 POYDRAS ST", "12A")
    assert load_address_points.roll_address("500 PORT OF NEW ORLEANS PLACE SPC 1018") == (
        "500 PORT OF NEW ORLEANS PL",
        "1018",
    )
    assert load_address_points.roll_address("3 POYDRAS STREET GA") == ("3 POYDRAS ST", "GA")
    assert load_address_points.roll_address("100 Avenue A") == ("100 AVENUE A", None)  # a street, not a unit
    assert load_address_points.roll_address("100 North Saint Patrick Street") == ("100 N ST PATRICK ST", None)
    assert load_address_points.roll_address("100 N ST PATRICK ST") == ("100 N ST PATRICK ST", None)
    assert load_address_points.roll_address("1530 Saint Charles Avenue") == ("1530 ST CHARLES AVE", None)


class _FakeSession:
    def __init__(self, pages):
        self.pages = pages
        self.asked = []

    def get_json(self, url, params=None, cache_key=None):
        self.asked.append(params["$offset"])
        return self.pages[len(self.asked) - 1]


def test_load_stores_points_in_roll_style_and_keeps_rows_on_a_short_pull(con, monkeypatch):
    monkeypatch.setattr(load_address_points, "PAGE_SIZE", 2)
    pages = [
        [
            {"address": "600 Port of New Orleans Place", "geopin": "41212159"},
            {"address": "3 Poydras Street Unit 8H", "geopin": "41212159"},
        ],
        [{"address": "1 Port of New Orleans Place"}],  # no lot: skipped
    ]
    session = _FakeSession(pages)
    assert load_address_points.load(con, session=session) == {"orleans": 2}
    assert session.asked == [0, 2]
    assert con.execute("SELECT address, unit, lot_id FROM address_points ORDER BY address").fetchall() == [
        ("3 POYDRAS ST", "8H", "41212159"),
        ("600 PORT OF NEW ORLEANS PL", None, "41212159"),
    ]
    with pytest.raises(RuntimeError, match="under half"):
        load_address_points.load(con, session=_FakeSession([[]]))
    assert con.execute("SELECT COUNT(*) FROM address_points").fetchone()[0] == 2  # kept


def _raw(con, rows):
    con.execute("CREATE TABLE assessor_parcels_raw (parish VARCHAR, parcel_id VARCHAR, payload VARCHAR)")
    con.executemany(
        "INSERT INTO assessor_parcels_raw VALUES ('orleans', ?, ?)",
        [(pid, json.dumps({"lot_id": lot} if lot else {})) for pid, lot in rows],
    )


def test_lot_ids_prefer_the_recorded_lot(con):
    _raw(con, [("103109601", "41212159"), ("41033176", None), ("41033176", "41033176")])
    assert export_static._lot_ids(con) == {
        ("orleans", "103109601"): "41212159",
        ("orleans", "41033176"): "41033176",
    }


def test_aliases_open_the_one_building_or_parcel_on_the_lot(con):
    con.execute(load_address_points.TABLE_SQL)
    con.executemany(
        "INSERT INTO address_points VALUES ('orleans', ?, NULL, ?, ?, NULL)",
        [
            ("600 PORT OF NEW ORLEANS PL", "41212159", "600 Port of New Orleans Place"),
            ("1 POYDRAS ST", "41212159", "1 Poydras Street"),  # on the roll already
            ("2704 CANAL ST", "41212447", "2704 Canal Street"),
            ("10 SHARED LOT ST", "41000001", "10 Shared Lot Street"),  # lot with two houses
        ],
    )
    buildings = {
        ("orleans", "1 POYDRAS ST"): {"slug": "1-poydras-st", "full": "1 Poydras St, New Orleans, LA 70130"}
    }
    lot_targets = {
        ("orleans", "41212159"): {("building", ("orleans", "1 POYDRAS ST"))},
        ("orleans", "41212447"): {("parcel", "2700-canal-st", "2700 Canal St, New Orleans, LA 70119")},
        ("orleans", "41000001"): {
            ("parcel", "12-shared-lot-st", "12 Shared Lot St, New Orleans, LA 70119"),
            ("parcel", "14-shared-lot-st", "14 Shared Lot St, New Orleans, LA 70119"),
        },
    }
    known = {("orleans", "1 POYDRAS ST")}
    assert export_static._address_aliases(con, known, lot_targets, buildings) == [
        (
            "2704 CANAL ST",
            "2704 Canal St, New Orleans, LA 70119",
            "2700-canal-st",
            "2700 Canal St, New Orleans, LA 70119",
        ),
        (
            "600 PORT OF NEW ORLEANS PL",
            "600 Port Of New Orleans Pl, New Orleans, LA 70130",
            "1-poydras-st",
            "1 Poydras St, New Orleans, LA 70130",
        ),
    ]


def test_backend_lookup_follows_an_address_point_to_its_lot(con, monkeypatch):
    con.execute(load_address_points.TABLE_SQL)
    con.execute(
        "INSERT INTO address_points VALUES ('orleans', ?, NULL, '41212159', '', NULL)",
        ["600 PORT OF NEW ORLEANS PL"],
    )
    _raw(con, [("103109601", "41212159")])
    con.execute(
        """CREATE TABLE parcel_market AS SELECT 'orleans' AS parish, '103109601' AS parcel_id,
           '103109601' AS tax_bill_number, '1 POYDRAS ST' AS site_address_norm"""
    )
    monkeypatch.setattr(queries, "_property_payload", lambda con, parcel: {"parcel": parcel})
    hit = queries.property_lookup(con, "600 Port of New Orleans Place, New Orleans, LA")
    assert hit["parcel"]["parcel_id"] == "103109601"
    assert hit["notice"].startswith("600 Port Of New Orleans Pl is on the same lot as 1 Poydras St")
