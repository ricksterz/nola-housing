import pytest

from backend.owners import owner_key, owner_kind
from etl import export_owners


@pytest.mark.parametrize(
    "name, key",
    [
        ("NEW ORLEANS,CITY OF", "CITY OF NEW ORLEANS"),
        ("THE CITY OF NEW ORLEANS", "CITY OF NEW ORLEANS"),
        ("BABIN,TODD J", "BABIN TODD J"),  # Jefferson's comma
        ("A&B PROPERTIES L.L.C.", "A & B PROPERTIES LLC"),
        ("DUPLESSY CLIFFORD J C/O CITY OF NO", "DUPLESSY CLIFFORD J"),  # a mailing note, not an owner
        ("  ", None),
    ],
)
def test_owner_key(name, key):
    assert owner_key(name) == key


@pytest.mark.parametrize(
    "name, kind",
    [
        ("HOUSING AUTHORITY OF NEW ORLEANS", "government"),
        ("NEW ORLEANS,CITY OF", "government"),
        ("STATE OF LOUISIANA-DOTD", "government"),
        ("MARY FUND PARC LLC", "organization"),
        ("GARDEN DISTRICT PROPERTIES LLC", "organization"),  # a company form beats "DISTRICT"
        ("MURPHY OIL USA INC", "organization"),
        ("GREATER LIBERTY BAPTIST CHURCH", "organization"),
        ("DENISE B MERLONE SEPARATE PROPERTY TRUST", "organization"),  # trusts are organizations
        ("SOUTHERN SCRAP MATERIAL CO", "organization"),
        # People, including ones whose names hold an organization word.
        ("SEXTON GLORIA M", "individual"),
        ("CHURCH JOHN A", "individual"),
        ("TEMPLE FRANK L", "individual"),
        ("HOMES JUSTIN H", "individual"),
        ("LODGE EARL E", "individual"),
        ("VENTURE COREY M", "individual"),
        ("BANKS MARY", "individual"),
        ("BAPTIST BRITNEY K", "individual"),
        ("BROWN CHRISTIAN P", "individual"),
        ("GARCIA TRUSTEE ROSA C", "individual"),  # a person acting as trustee
        ("WILLIAMS L P", "individual"),  # initials, not a partnership
        ("DUPLESSY CLIFFORD J C/O CITY OF NO", "individual"),
        (None, None),
    ],
)
def test_owner_kind(name, kind):
    assert owner_kind(name) == kind


def test_display_name():
    assert export_owners.display_name("NEW ORLEANS,CITY OF") == "City of New Orleans"
    assert export_owners.display_name("STATE OF LOUISIANA-DOTD") == "State of Louisiana-DOTD"
    assert export_owners.display_name("MARY FUND PARC LLC") == "Mary Fund Parc LLC"


def _parcel(pid, owner, parish="orleans", zip_code="70130", **kw):
    return {
        "parish": parish,
        "parcel_id": pid,
        "owner_name": owner,
        "zip_code": zip_code,
        "lat": 29.95,
        "lng": -90.07,
        "flood_zone": "AE",
        "flood_sfha": True,
        **kw,
    }


AREAS = [
    {"geo_level": "metro", "geo_id": "35380", "parish": None},
    {"geo_level": "county", "geo_id": "22071", "parish": "orleans"},
    {"geo_level": "county", "geo_id": "22051", "parish": "jefferson"},
    {"geo_level": "zip", "geo_id": "70130", "parish": "orleans"},
]


def _owners():
    parcels = [
        _parcel("1", "NEW ORLEANS,CITY OF"),
        _parcel("2", "CITY OF NEW ORLEANS"),
        _parcel("3", "CITY OF NEW ORLEANS", parish="jefferson", zip_code=None, bld_val=0),
        _parcel("4", "SEXTON GLORIA M"),
        _parcel("5", "SEXTON GLORIA M"),
        _parcel("6", "ONE OFF LLC"),
        _parcel(
            "7", "DOE JANE", parish="jefferson", zip_code=None, bld_val=100_000, homestead_exempt_val=75_000
        ),
        _parcel(
            "8", "ROE RICHARD", parish="jefferson", zip_code=None, bld_val=90_000, homestead_exempt_val=0
        ),
    ]
    owners = export_owners.Owners(parcels)
    for p in parcels:
        owners.add_page(p, f"parcel-{p['parcel_id']}", f"{p['parcel_id']} Main St, New Orleans, LA 70130")
    return owners, parcels


def test_owners_with_several_records_get_a_page_and_a_same_owner_link():
    owners, parcels = _owners()
    assert set(owners.pages()) == {"city-of-new-orleans", "sexton-gloria-m"}
    assert owners.ref(parcels[3]) == {
        "slug": "sexton-gloria-m",
        "name": "Sexton Gloria M",
        "kind": "individual",
        "count": 2,
    }
    assert owners.ref(parcels[5]) is None  # a one-record owner: nothing else to list
    page = owners.pages()["city-of-new-orleans"]
    assert page["count"] == 3 and page["parishes"] == {"orleans": 2, "jefferson": 1}
    assert page["also_written"] == ["New Orleans,City Of"]


def test_name_index_finds_owners_by_any_name_word():
    owners, _ = _owners()
    index = owners.name_index()
    assert ["sexton-gloria-m", "Sexton Gloria M", 2, "individual", None, None] in index["SEXT"]
    assert ["sexton-gloria-m", "Sexton Gloria M", 2, "individual", None, None] in index[
        "GLOR"
    ]  # first name first
    # One record: the entry opens that property.
    assert index["ONE"] == [
        [None, "One Off LLC", 1, "organization", "parcel-6", "6 Main St, New Orleans, LA 70130"]
    ]
    assert "LLC" not in index  # "LLC" alone isn't searched by


def test_stats():
    owners, _ = _owners()
    stats = owners.stats(AREAS)
    metro = stats["metro:35380"]
    assert metro["records"] == 8 and metro["owners"] == 5
    assert metro["by_kind"] == {"individual": 4, "organization": 1, "government": 3}
    assert metro["by_holder_size"] == {"1": 3, "2-9": 5, "10+": 0}
    assert [t[1] for t in metro["top_owners"]] == ["City of New Orleans", "Sexton Gloria M"]
    assert stats["county:22051"]["homestead_share"] == 0.5  # Doe claims it, Roe doesn't; no building on 3
    assert stats["county:22071"]["homestead_share"] is None  # Orleans publishes no values
    assert stats["zip:70130"]["records"] == 5


def test_redacted_owner_names_turn_owner_listings_off():
    parcels = [_parcel("1", "CITY OF NEW ORLEANS"), _parcel("2", "CITY OF NEW ORLEANS")]
    owners = export_owners.Owners(parcels, enabled=False)
    assert owners.ref(parcels[0]) is None
    assert owners.stats(AREAS)["metro:35380"]["top_owners"] == []
    assert owners.name_index() == {}
