import json
from datetime import datetime

import pytest
import requests

from etl import config, load_assessor, load_flood
from etl.assessor.base import ParcelRecord
from etl.assessor.http import PoliteSession
from tests.conftest import FakeResponse


def _square(x0, y0, x1, y1):
    # Esri outer rings run clockwise.
    return [[[x0, y0], [x0, y1], [x1, y1], [x1, y0], [x0, y0]]]


ZONES_PAGE = json.dumps(
    {
        "geometryType": "esriGeometryPolygon",
        "spatialReference": {"wkid": 4326},
        "fields": [
            {"name": "FLD_ZONE", "type": "esriFieldTypeString", "alias": "FLD_ZONE", "length": 17},
            {"name": "ZONE_SUBTY", "type": "esriFieldTypeString", "alias": "ZONE_SUBTY", "length": 72},
            {"name": "SFHA_TF", "type": "esriFieldTypeString", "alias": "SFHA_TF", "length": 1},
        ],
        "features": [
            {
                "attributes": {"FLD_ZONE": "AE", "ZONE_SUBTY": None, "SFHA_TF": "T"},
                "geometry": {"rings": _square(-90.20, 30.00, -90.18, 30.02)},
            },
            {
                # Overlaps the AE square between -90.19 and -90.18.
                "attributes": {
                    "FLD_ZONE": "X",
                    "ZONE_SUBTY": "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE",
                    "SFHA_TF": "F",
                },
                "geometry": {"rings": _square(-90.19, 30.00, -90.17, 30.02)},
            },
        ],
    }
)


def _parcels(con):
    load_assessor.ensure_tables(con)
    now = datetime(2026, 9, 24)
    for pid, lng in [("A", -90.195), ("B", -90.185), ("C", -90.175), ("D", -90.10)]:
        rec = ParcelRecord("jefferson", "22051", pid, site_address=f"{pid} TEST ST", lat=30.01, lng=lng)
        load_assessor._insert(con, rec, "bulk:arcgis", "https://gis.test", now)
    load_assessor.build_derived(con)


def _session(fake_http, status=200, body=ZONES_PAGE):
    def handler(url, params):
        return FakeResponse(url, status, body, "application/json")

    return PoliteSession(
        session=fake_http({config.NFHL_ZONES_URL: handler}),
        min_interval=0,
        max_retries=1,
        sleep=lambda _: None,
    )


def test_assigns_zone_by_lot_center_preferring_high_risk(con, fake_http):
    _parcels(con)
    assert load_flood.load(con, parishes=["jefferson"], session=_session(fake_http)) == {"jefferson": 3}
    rows = dict(
        (pid, (zone, sub, sfha))
        for pid, zone, sub, sfha in con.execute(
            "SELECT parcel_id, flood_zone, flood_zone_subtype, flood_sfha FROM parcel_flood"
        ).fetchall()
    )
    assert rows["A"] == ("AE", None, True)
    assert rows["B"] == ("AE", None, True)  # inside both polygons -> the high-risk zone wins
    assert rows["C"] == ("X", "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE", False)
    assert "D" not in rows  # outside every zone: no row, rather than a guess


def test_tiled_polygons_give_same_answer(con, fake_http, monkeypatch):
    # Force every fixture polygon through the tiling path. The parcels' coordinates are exact
    # multiples of 0.005°, so they sit on tile cuts — only a boundary-inclusive match keeps them.
    monkeypatch.setattr(load_flood, "TILE_VERTICES", 3)
    monkeypatch.setattr(load_flood, "TILE_DEGREES", 0.005)
    _parcels(con)
    assert load_flood.load(con, parishes=["jefferson"], session=_session(fake_http)) == {"jefferson": 3}
    zones = dict(con.execute("SELECT parcel_id, flood_zone FROM parcel_flood").fetchall())
    assert zones == {"A": "AE", "B": "AE", "C": "X"}


def test_failed_fetch_keeps_previous_zones(con, fake_http):
    _parcels(con)
    load_flood.load(con, parishes=["jefferson"], session=_session(fake_http))
    with pytest.raises(requests.HTTPError):
        load_flood.load(con, parishes=["jefferson"], session=_session(fake_http, status=503, body="down"))
    assert con.execute("SELECT COUNT(*) FROM parcel_flood").fetchone()[0] == 3


def test_raw_table_gains_new_columns(con):
    old = [c for c in load_assessor.RAW_COLUMNS if c not in ("zoning", "last_sale_qualified")]
    con.execute(f"CREATE TABLE assessor_parcels_raw ({', '.join(f'{c} VARCHAR' for c in old)})")
    load_assessor.ensure_tables(con)
    rec = ParcelRecord("jefferson", "22051", "Z1", zoning=" R1A ", last_sale_qualified="True")
    load_assessor._insert(con, rec, "bulk:arcgis", "https://gis.test", datetime(2026, 9, 24))
    assert con.execute("SELECT zoning, last_sale_qualified FROM assessor_parcels_raw").fetchone() == (
        "R1A",
        True,
    )
