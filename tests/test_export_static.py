import json
import re
from pathlib import Path

import duckdb
import pytest

from etl import export_static
from etl.export_static import BUNDLES, Bundles, bundle_key

ROOT = Path(__file__).resolve().parent.parent


def test_bundle_key_is_stable_and_padded():
    # The same cases as cloudflare/link-previews/test/meta.test.js: the app and the Worker hash
    # keys the same way, or they look for a page in the wrong file.
    assert bundle_key("1-poydras-st", 8192) == "18ad"
    assert bundle_key("parcel-103109601", 8192) == "0e2e"
    assert bundle_key("housing-authority-of-new-orleans", 512) == "0d6"
    assert bundle_key("SEXT", 2048) == "669"
    assert all(len(bundle_key(str(i), 8192)) == 4 for i in range(200))


def _js_bundles(path: Path) -> dict[str, int]:
    block = re.search(r"BUNDLES = \{(.*?)\}", path.read_text(), re.S).group(1)
    return {k: int(v) for k, v in re.findall(r"(\w+): (\d+)", block)}


def test_bundle_counts_match_the_app_and_the_worker():
    assert _js_bundles(ROOT / "frontend/src/lib/bundles.js") == BUNDLES
    worker = _js_bundles(ROOT / "cloudflare/link-previews/src/meta.js")
    assert worker == {k: BUNDLES[k] for k in worker}


def test_bundles_write_pages_by_key_and_drop_stale_files(tmp_path, monkeypatch):
    monkeypatch.setitem(export_static.BUNDLES, "props", 16)
    stale = tmp_path / "props" / "zz.json"
    stale.parent.mkdir()
    stale.write_text("{}")
    pages = Bundles("props")
    for slug in ("1-poydras-st", "418-bonnabel-blvd", "parcel-103109601"):
        pages.add(slug, {"slug": slug})
    pages.write(tmp_path)
    assert not stale.exists()
    found = {}
    for f in (tmp_path / "props").glob("*.json"):
        for slug, page in json.loads(f.read_text()).items():
            assert f.stem == bundle_key(slug, 16)
            found[slug] = page
    assert found == {s: {"slug": s} for s in ("1-poydras-st", "418-bonnabel-blvd", "parcel-103109601")}


def test_a_join_older_than_the_code_fails_the_export(tmp_path, monkeypatch):
    # The published database once had its assessor tables migrated but not its join: parcel_market
    # without exempt_val, so a convent's full exemption showed as a homestead. The deploy must stop.
    monkeypatch.setattr(export_static, "OUT_DIR", tmp_path)
    con = duckdb.connect()
    con.execute("CREATE TABLE parcel_market (parcel_id VARCHAR, homestead_exempt_val DOUBLE)")
    with pytest.raises(SystemExit, match="parcel_market.exempt_val"):
        export_static.export_properties(con)
