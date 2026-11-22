"""The Python half of the rules the site re-implements in JavaScript. The cases live in
fixtures/js_parity.json; frontend/test/parity.test.js and cloudflare/link-previews/test/parity.test.js
check the JavaScript copies against the same file."""

import json
from pathlib import Path

import pytest

from backend.queries import slugify
from etl.export_owners import display_name
from etl.export_static import bundle_key, near_key

CASES = json.loads((Path(__file__).parent / "fixtures" / "js_parity.json").read_text())


@pytest.mark.parametrize("key, n, expected", CASES["bundle_key"])
def test_bundle_key(key, n, expected):
    assert bundle_key(key, n) == expected


@pytest.mark.parametrize("lat, lng, expected", CASES["near_key"])
def test_near_key(lat, lng, expected):
    assert near_key(lat, lng) == expected


@pytest.mark.parametrize("raw, expected", CASES["display_name"])
def test_display_name(raw, expected):
    assert display_name(raw) == expected


@pytest.mark.parametrize("raw, expected", CASES["slugify"])
def test_slugify(raw, expected):
    assert slugify(raw) == expected
