"""Jefferson's HOMESTEADV is every exemption combined, not homestead: 420 Bonnabel Blvd, owned by a
convent, carries its whole $28,110 assessed value as HOMESTEADV with $0 land and building."""

import json

import duckdb

from etl import export_owners, load_assessor
from etl.assessor import bulk
from etl.assessor.base import map_aliases
from tests.conftest import FakeResponse
from tests.test_assessor_http_and_bulk import _session
from tests.test_owners import AREAS, _parcel

# 420 Bonnabel Blvd as Jefferson's PAO_MAP_2025 layer returned it (Oct 2026 pull).
BONNABEL_420 = {
    "TAXROLLPAR": "9820040831",
    "PARCELADDR": "420 BONNABEL BLVD",
    "OWNERNAME": "CONVENT OF TH MOST HOLY",
    "ASSESSED_V": 28110.0,
    "HOMESTEADV": 28110.0,
    "LANDVALUE": 0.0,
    "IMPROVEMEN": 0.0,
}


def test_jefferson_total_exemption_field_is_not_mapped_as_homestead():
    names = {f: f for f in (*BONNABEL_420, "LEGAL_DESC", "PARCELSUBD", "ZIP")}
    field_map = map_aliases(names, bulk.DEFAULT_FIELD_ALIASES)
    assert field_map["exempt_val"] == "HOMESTEADV"
    assert "homestead_exempt_val" not in field_map


def test_a_fully_exempt_parcel_loads_its_exemption_as_total_not_homestead(fake_http):
    body = json.dumps({"features": [{"attributes": BONNABEL_420, "geometry": {"x": -90.15, "y": 29.99}}]})
    fake = fake_http(
        {"https://gis.test/L/72": lambda url, params: FakeResponse(url, 200, body, "application/json")}
    )
    field_map = map_aliases({f: f for f in BONNABEL_420}, bulk.DEFAULT_FIELD_ALIASES)
    [r] = bulk.fetch_arcgis("https://gis.test/L/72", _session(fake), "jefferson", "22051", field_map)
    assert r.exempt_val == 28110 and r.assessed_val == 28110
    assert r.homestead_exempt_val is None


def _raw_db(tmp_path):
    con = duckdb.connect(str(tmp_path / "db.duckdb"))
    load_assessor.ensure_tables(con)
    # A row loaded before the fix: HOMESTEADV in the payload, its value in homestead_exempt_val.
    con.execute(
        "INSERT INTO assessor_parcels_raw (parish, parcel_id, assessed_val, homestead_exempt_val, payload) "
        "VALUES ('jefferson', '9820040831', 28110, 28110, ?)",
        [json.dumps({"raw": BONNABEL_420})],
    )
    # A true homestead field from a detail page (no HOMESTEADV): must stay homestead.
    con.execute(
        "INSERT INTO assessor_parcels_raw (parish, parcel_id, assessed_val, homestead_exempt_val, payload) "
        "VALUES ('jefferson', '0520001234', 57500, 7500, ?)",
        [json.dumps({"value_history": []})],
    )
    return con


def test_migration_moves_loaded_total_exemptions_out_of_homestead(tmp_path):
    con = _raw_db(tmp_path)
    assert load_assessor.migrate_exempt_val(con) == 1
    rows = dict(
        (pid, (home, exempt))
        for pid, home, exempt in con.execute(
            "SELECT parcel_id, homestead_exempt_val, exempt_val FROM assessor_parcels_raw"
        ).fetchall()
    )
    assert rows["9820040831"] == (None, 28110)
    assert rows["0520001234"] == (7500, None)
    assert load_assessor.migrate_exempt_val(con) == 0  # idempotent


def _jp(pid, owner, **kw):
    return _parcel(pid, owner, parish="jefferson", zip_code=None, **kw)


def test_lived_in_share_leaves_out_full_exemptions_held_by_public_bodies():
    parcels = [
        # Fully exempt, owned by a public body: not a homestead.
        _jp("1", "PARISH OF JEFFERSON", bld_val=50_000, assessed_val=40_000, exempt_val=40_000),
        _jp("2", "DOE JANE", bld_val=100_000, assessed_val=30_000, exempt_val=7_500),  # the homestead
        _jp("3", "ROE RICHARD", bld_val=90_000, assessed_val=25_000, exempt_val=0),
        _jp("4", "POE ANN", bld_val=80_000, assessed_val=20_000, homestead_exempt_val=7_500),
        # A trust's homestead, and a fully disabled veteran's home exempt in full: both lived in.
        _jp("5", "SMITH FAMILY TRUST", bld_val=80_000, assessed_val=20_000, exempt_val=7_500),
        _jp("6", "MILLER RYAN", bld_val=70_000, assessed_val=15_000, exempt_val=15_000),
    ]
    stats = export_owners.Owners(parcels).stats(AREAS)
    # All but the parish's building and Roe's.
    assert stats["county:22051"]["homestead_share"] == round(4 / 6, 4)
