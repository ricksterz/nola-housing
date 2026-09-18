import json
from pathlib import Path

import duckdb
import pytest

from etl import config

FX = Path(__file__).parent / "fixtures"


@pytest.fixture
def fx() -> Path:
    return FX


@pytest.fixture
def con():
    c = duckdb.connect(":memory:")
    yield c
    c.close()


@pytest.fixture
def redfin_fixtures(monkeypatch):
    monkeypatch.setattr(
        config,
        "REDFIN_SOURCES",
        {
            "county": str(FX / "county_market_tracker.tsv"),
            "metro": str(FX / "redfin_metro_market_tracker.tsv"),
            "zip": str(FX / "zip_code_market_tracker.tsv"),
        },
    )


@pytest.fixture
def zillow_fixtures(monkeypatch):
    monkeypatch.setenv("ZILLOW_SOURCE_DIR", str(FX / "zillow"))


@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    d = tmp_path / "raw"
    monkeypatch.setattr(config, "RAW_DIR", d)
    return d


# ---------------------------------------------------------------------------
# Fake HTTP layer: stands in for requests.Session inside PoliteSession.
# ---------------------------------------------------------------------------
class FakeResponse:
    def __init__(self, url, status=200, body="", content_type="text/html", headers=None):
        self.url = url
        self.status_code = status
        self._body = body if isinstance(body, (bytes, bytearray)) else str(body).encode()
        self.headers = {"Content-Type": content_type, **(headers or {})}

    @property
    def text(self):
        return self._body.decode()

    @property
    def content(self):
        return self._body

    def json(self):
        return json.loads(self.text)

    def raise_for_status(self):
        if self.status_code >= 400:
            import requests

            raise requests.HTTPError(f"{self.status_code} for {self.url}", response=self)


class FakeHTTP:
    """Route by URL prefix; each route is (status, body, content_type) or a callable(url, params)."""

    def __init__(self, routes=None, robots: str | None = None):
        self.routes = routes or {}
        self.robots = robots
        self.headers = {}
        self.calls: list[tuple[str, dict | None]] = []

    def get(self, url, params=None, timeout=None):
        self.calls.append((url, params))
        if url.endswith("/robots.txt"):
            if self.robots is None:
                return FakeResponse(url, 404, "", "text/plain")
            return FakeResponse(url, 200, self.robots, "text/plain")
        for prefix, handler in self.routes.items():
            if url.startswith(prefix):
                if callable(handler):
                    return handler(url, params)
                status, body, ctype = handler
                return FakeResponse(url, status, body, ctype)
        return FakeResponse(url, 404, "not found", "text/html")


@pytest.fixture
def fake_http():
    return FakeHTTP


@pytest.fixture
def fred_fixture_get(monkeypatch):
    """Patch etl.fred_client.requests.get to serve the fixture observations."""
    from etl import fred_client

    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params)
        sid = params["series_id"]
        path = FX / "fred" / f"{sid}.json"
        if not path.exists():
            return FakeResponse(
                url, 400, json.dumps({"error_message": "Bad Request. The series does not exist."})
            )
        data = json.loads(path.read_text())
        if params.get("limit") == 1 and params.get("sort_order") == "desc":
            data = {**data, "observations": data["observations"][-1:]}
        return FakeResponse(url, 200, json.dumps(data), "application/json")

    monkeypatch.setattr(fred_client.requests, "get", fake_get)
    monkeypatch.setenv("FRED_API_KEY", "test-key")
    fred_client._cache["data"] = None
    return calls
