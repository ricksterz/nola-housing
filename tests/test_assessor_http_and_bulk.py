import json

import pytest

from etl.assessor import bulk
from etl.assessor.http import BudgetExhausted, PoliteSession, RobotsDisallowed


def _session(fake, **kw):
    kw.setdefault("sleep", lambda s: None)
    kw.setdefault("min_interval", 0)
    return PoliteSession(session=fake, **kw)


def test_polite_session_paces_and_budgets(fake_http):
    slept = []
    fake = fake_http({"https://a.test/p": (200, "ok", "text/html")})
    s = PoliteSession(session=fake, min_interval=2.0, max_requests=2, sleep=slept.append)
    s.get("https://a.test/p")
    s.get("https://a.test/p")
    assert slept and slept[0] > 1.0  # second call waited ~min_interval
    with pytest.raises(BudgetExhausted):
        s.get("https://a.test/p")
    assert "nola-housing-etl" in fake.headers["User-Agent"]


def test_polite_session_respects_robots(fake_http):
    fake = fake_http(
        {"https://a.test/": (200, "ok", "text/html")}, robots="User-agent: *\nDisallow: /search/\n"
    )
    s = _session(fake)
    assert s.allowed("https://a.test/detail/1")
    with pytest.raises(RobotsDisallowed):
        s.get("https://a.test/search/1")


def test_polite_session_retries_on_429_then_succeeds(fake_http):
    state = {"n": 0}

    def flaky(url, params):
        from tests.conftest import FakeResponse

        state["n"] += 1
        if state["n"] < 3:
            return FakeResponse(url, 429, "slow down", headers={"Retry-After": "1"})
        return FakeResponse(url, 200, "fine")

    fake = fake_http({"https://a.test/": flaky})
    slept = []
    s = PoliteSession(session=fake, min_interval=0, sleep=slept.append)
    assert s.get("https://a.test/x").text == "fine"
    assert state["n"] == 3 and slept.count(1.0) == 2


def test_polite_session_writes_raw_cache(fake_http, tmp_path):
    fake = fake_http({"https://a.test/": (200, "<html>hi</html>", "text/html")})
    s = _session(fake, raw_dir=tmp_path)
    s.get("https://a.test/d/1", cache_key="jefferson/detail_1")
    assert (tmp_path / "jefferson" / "detail_1.html").read_text() == "<html>hi</html>"


def _arcgis_fake(fx, fake_http):
    layer = (fx / "assessor" / "arcgis_layer.json").read_text()
    count = (fx / "assessor" / "arcgis_count.json").read_text()
    query = (fx / "assessor" / "arcgis_query.json").read_text()

    def handler(url, params):
        from tests.conftest import FakeResponse

        if url.endswith("/query"):
            body = count if params.get("returnCountOnly") else query
            return FakeResponse(url, 200, body, "application/json")
        return FakeResponse(url, 200, layer, "application/json")

    return fake_http({"https://gis.test/Parcels/MapServer/0": handler})


def test_probe_and_fetch_arcgis(fx, fake_http):
    fake = _arcgis_fake(fx, fake_http)
    s = _session(fake)
    res = bulk.probe_arcgis("https://gis.test/Parcels/MapServer/0", s)
    assert res.ok and res.record_count == 2
    assert res.field_map["parcel_id"] == "PARCELID"
    assert res.field_map["assessed_val"] == "ASSESSED_VALUE"
    assert res.field_map["bld_val"] == "IMPR_VAL"

    recs = bulk.fetch_arcgis("https://gis.test/Parcels/MapServer/0", s, "jefferson", "22051", res.field_map)
    assert [r.parcel_id for r in recs] == ["0520001234", "0520009999"]
    r = recs[0]
    assert r.owner_name == "DOE, JANE" and r.assessed_val == 57500 and r.zip_code == "70005"
    assert r.last_sale_date == "2019-06-15" and r.last_sale_price == 489000
    assert abs(r.lat - 29.995) < 1e-6 and abs(r.lng - (-90.135)) < 1e-6
    assert r.extra["raw"]["PARCELID"] == "0520001234"  # raw attributes preserved
    q = [p for u, p in fake.calls if u.endswith("/query") and p.get("outFields")][0]
    assert q["outSR"] == "4326" and q["returnGeometry"] == "true"


def test_probe_arcgis_rejects_unmappable_or_error(fake_http):
    fake = fake_http(
        {
            "https://gis.test/err": (200, json.dumps({"error": {"code": 400}}), "application/json"),
            "https://gis.test/nomap": (
                200,
                json.dumps({"fields": [{"name": "OBJECTID"}, {"name": "SHAPE"}]}),
                "application/json",
            ),
        }
    )
    s = _session(fake)
    assert not bulk.probe_arcgis("https://gis.test/err", s).ok
    r = bulk.probe_arcgis("https://gis.test/nomap", s)
    assert not r.ok and "not mappable" in r.reason


def test_probe_socrata_requires_dataset_id_and_maps_columns(fake_http):
    s = _session(fake_http())
    r = bulk.probe_socrata("data.nola.gov", "", s)
    assert not r.ok and "dataset id" in r.reason

    meta = {
        "columns": [{"fieldName": "tax_bill_number"}, {"fieldName": "owner_name"}, {"fieldName": "location"}]
    }
    rows = [
        {
            "tax_bill_number": "512345678",
            "owner_name": "ROE",
            "location": {"type": "Point", "coordinates": [-90.07, 29.93]},
        }
    ]
    fake = fake_http(
        {
            "https://data.nola.gov/api/views/abcd-1234.json": (200, json.dumps(meta), "application/json"),
            "https://data.nola.gov/resource/abcd-1234.json": (200, json.dumps(rows), "application/json"),
        }
    )
    s = _session(fake)
    r = bulk.probe_socrata("data.nola.gov", "abcd-1234", s)
    assert not r.ok  # tax_bill_number alone is not a parcel_id alias
    aliases = {**bulk.DEFAULT_FIELD_ALIASES, "parcel_id": ("tax_bill_number",)}
    r = bulk.probe_socrata("data.nola.gov", "abcd-1234", s, aliases)
    assert r.ok
    recs = bulk.fetch_socrata("data.nola.gov", "abcd-1234", s, "orleans", "22071", r.field_map)
    assert recs[0].parcel_id == "512345678" and recs[0].lat == 29.93 and recs[0].lng == -90.07


def test_probe_candidates_order(fx, fake_http):
    fake = _arcgis_fake(fx, fake_http)
    s = _session(fake)
    res = bulk.probe_candidates(
        [
            {"kind": "socrata", "domain": "data.nola.gov", "dataset_id": ""},
            {"kind": "arcgis", "url": "https://gis.test/Parcels/MapServer/0"},
        ],
        s,
    )
    assert [r.ok for r in res] == [False, True]


@pytest.mark.parametrize(
    "owner, line, expected",
    [
        (
            "DETIEGE,WILLIE JR &",
            "LEONORIA S DETIEGE 1506 AMES BLVD",
            "DETIEGE,WILLIE JR & LEONORIA S DETIEGE",
        ),
        ("SMUCK,STEVEN M &", "JANE SMUCK PO BOX 55", "SMUCK,STEVEN M & JANE SMUCK"),
        ("SMUCK,STEVEN M &", "JANE SMUCK", "SMUCK,STEVEN M & JANE SMUCK"),
        ("SMUCK,STEVEN M &", "1506 AMES BLVD", "SMUCK,STEVEN M &"),  # no name on the line
        ("SMUCK,STEVEN M &", "C/O ACME LLC 1 MAIN ST", "SMUCK,STEVEN M &"),  # care-of, not an owner
        ("DOE,JANE", "1506 AMES BLVD", "DOE,JANE"),  # single owner: the line is only an address
        ("  ", None, None),
    ],
)
def test_join_co_owner(owner, line, expected):
    assert bulk.join_co_owner(owner, line) == expected


def test_fetch_arcgis_joins_co_owner_and_drops_the_mailing_address(fake_http):
    from tests.conftest import FakeResponse

    feature = {
        "attributes": {
            "TAXROLLPAR": "0820015268",
            "OWNERNAME": "DETIEGE,WILLIE JR &",
            "OWNER_ADDR": "LEONORIA S DETIEGE 1506 AMES BLVD",
        },
        "geometry": {"x": -90.1, "y": 29.9},
    }
    body = json.dumps({"features": [feature]})
    fake = fake_http(
        {"https://gis.test/L/0": lambda url, params: FakeResponse(url, 200, body, "application/json")}
    )
    field_map = {"parcel_id": "TAXROLLPAR", "owner_name": "OWNERNAME", "co_owner_line": "OWNER_ADDR"}
    [r] = bulk.fetch_arcgis("https://gis.test/L/0", _session(fake), "jefferson", "22051", field_map)
    assert r.owner_name == "DETIEGE,WILLIE JR & LEONORIA S DETIEGE"
    assert "OWNER_ADDR" not in r.extra["raw"] and "co_owner_line" not in r.extra
    assert "AMES" not in json.dumps(r.extra)
