import json

import duckdb
import pytest
import requests

from etl import config, db_store
from tests.conftest import FakeResponse


def _db(path, parcels=10):
    con = duckdb.connect(str(path))
    con.execute("CREATE TABLE assessor_parcels AS SELECT range AS id FROM range(?)", [parcels])
    con.execute("CREATE TABLE market_monthly AS SELECT 1 AS x")
    con.execute("CREATE TABLE parcel_market AS SELECT 1 AS x")
    con.close()
    return path


def test_check_rejects_missing_and_empty_tables(tmp_path):
    assert db_store.check(_db(tmp_path / "ok.duckdb"))["assessor_parcels"] == 10
    empty = tmp_path / "empty.duckdb"
    duckdb.connect(str(empty)).close()  # what connect() leaves behind when the pull was skipped
    with pytest.raises(db_store.DatabaseCheckFailed, match="missing"):
        db_store.check(empty)
    with pytest.raises(db_store.DatabaseCheckFailed, match="no rows in assessor_parcels"):
        db_store.check(_db(tmp_path / "zero.duckdb", parcels=0))


class _Download:
    def __init__(self, responses):
        self.responses = list(responses)
        self.urls = []

    def get(self, url, timeout=None):
        self.urls.append(url)
        r = self.responses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def test_pull_retries_and_only_replaces_with_a_good_file(tmp_path):
    good = _db(tmp_path / "src.duckdb").read_bytes()
    dest = tmp_path / "nola_housing.duckdb"
    dest.write_bytes(b"old")
    session = _Download([requests.ConnectionError("reset"), FakeResponse("u", 200, good)])
    db_store.pull(dest, session=session, sleep=lambda _: None)
    assert dest.read_bytes() == good
    assert (
        session.urls[0] == f"https://github.com/{config.DB_REPO}/releases/download/data/nola_housing.duckdb"
    )

    with pytest.raises(db_store.DatabaseCheckFailed):
        db_store.pull(dest, session=_Download([FakeResponse("u", 200, b"not a database")]))
    assert dest.read_bytes() == good  # a bad download never replaces the current file
    assert not (tmp_path / "nola_housing.duckdb.download").exists()


class _API:
    """Stands in for the GitHub releases API; tracks assets by name."""

    def __init__(self, assets):
        self.assets = dict(assets)  # name -> id
        self.next_id = 100
        self.calls = []
        self.fail_upload = False

    def request(self, method, url, params=None, json=None, data=None, headers=None, timeout=None):
        self.calls.append((method, url.rsplit("/", 1)[-1], params or json))
        if method == "GET":
            body = {"id": 7, "assets": [{"name": n, "id": i} for n, i in self.assets.items()]}
            return FakeResponse(url, 200, _json(body), "application/json")
        if method == "POST":
            if self.fail_upload:
                return FakeResponse(url, 502, "bad gateway")
            self.next_id += 1
            self.assets[params["name"]] = self.next_id
            return FakeResponse(url, 201, _json({"id": self.next_id}), "application/json")
        asset_id = int(url.rsplit("/", 1)[-1])
        name = next((n for n, i in self.assets.items() if i == asset_id), None)
        if method == "DELETE":
            del self.assets[name]
        elif method == "PATCH" and json and "name" in json:
            del self.assets[name]
            self.assets[json["name"]] = asset_id
        return FakeResponse(url, 200, "{}", "application/json")


def _json(o):
    return json.dumps(o)


def test_publish_swaps_assets_and_keeps_the_previous_copy(tmp_path):
    before = _db(tmp_path / "before.duckdb", parcels=10)
    after = _db(tmp_path / "after.duckdb", parcels=12)
    api = _API({"nola_housing.duckdb": 1, "nola_housing.previous.duckdb": 2})
    assert db_store.publish(after, before, notes="Flood zone refresh", token="t", session=api)
    # The old previous is gone, the old current became previous, the upload became current.
    assert api.assets == {"nola_housing.previous.duckdb": 1, "nola_housing.duckdb": 101}
    notes = [c for c in api.calls if c[0] == "PATCH" and c[2] and "body" in c[2]]
    assert "Flood zone refresh" in notes[0][2]["body"]


def test_failed_upload_leaves_the_release_untouched(tmp_path):
    api = _API({"nola_housing.duckdb": 1, "nola_housing.previous.duckdb": 2})
    api.fail_upload = True
    with pytest.raises(requests.HTTPError):
        db_store.publish(
            _db(tmp_path / "a.duckdb", 12), _db(tmp_path / "b.duckdb", 10), token="t", session=api
        )
    assert api.assets == {"nola_housing.duckdb": 1, "nola_housing.previous.duckdb": 2}


def test_publish_refuses_a_collapsed_parcel_table(tmp_path):
    api = _API({"nola_housing.duckdb": 1})
    with pytest.raises(db_store.DatabaseCheckFailed, match="fell from 100 to 10"):
        db_store.publish(
            _db(tmp_path / "a.duckdb", 10), _db(tmp_path / "b.duckdb", 100), token="t", session=api
        )
    assert api.calls == []


def test_unchanged_file_is_not_published(tmp_path):
    before = _db(tmp_path / "b.duckdb")
    after = tmp_path / "a.duckdb"
    after.write_bytes(before.read_bytes())
    api = _API({"nola_housing.duckdb": 1})
    assert db_store.publish(after, before, token="t", session=api) is False
    assert api.calls == []
