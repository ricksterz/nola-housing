import json
import re

import pytest

from etl import prerender

SHELL = """<!doctype html>
<html lang="en">
  <head>
    <title>NOLA Atlas</title>
    <meta name="description" content="x" />
    <link rel="canonical" href="https://nolaatlas.com/" />
    <meta property="og:title" content="x" />
    <meta property="og:description" content="x" />
    <meta property="og:url" content="https://nolaatlas.com/" />
    <meta property="og:image" content="https://nolaatlas.com/og/default.png" />
    <meta property="og:image:alt" content="x" />
    <meta name="twitter:title" content="x" />
    <meta name="twitter:description" content="x" />
    <meta name="twitter:image" content="https://nolaatlas.com/og/default.png" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/index.js"></script>
  </body>
</html>
"""

GEOS = [
    {"geo_level": "metro", "geo_id": "35380", "name": "New Orleans-Metairie, LA", "parish": None},
    {"geo_level": "county", "geo_id": "22051", "name": "Jefferson Parish", "parish": "jefferson"},
    {"geo_level": "zip", "geo_id": "70005", "name": "Old Metairie", "parish": "jefferson"},
    {"geo_level": "county", "geo_id": "22071", "name": "Orleans Parish", "parish": "orleans"},
    {"geo_level": "zip", "geo_id": "70130", "name": "French Quarter <& Lower Garden>", "parish": "orleans"},
]


def _area(records, org, gov, top):
    return {
        "records": records,
        "with_owner": records,
        "owners": records - 10,
        "by_kind": {"individual": records - org - gov, "organization": org, "government": gov},
        "by_holder_size": {"1": records - 20, "2-9": 15, "10+": 5},
        "top_owners_share": 0.02,
        "top_owners": top,
        "homestead_share": None,
    }


@pytest.fixture
def dist(tmp_path):
    (tmp_path / "data").mkdir()
    (tmp_path / "index.html").write_text(SHELL)
    (tmp_path / "data" / "meta.json").write_text(json.dumps({"geos": GEOS, "property_count": 305869}))
    rows = [
        {"geo_level": "metro", "geo_id": "35380", "median_sale_price": 355000, "price_month": "2026-05-01"},
        {
            "geo_level": "zip",
            "geo_id": "70130",
            "median_sale_price": 525000,
            "price_yoy_pct": 3.2,
            "zhvi": 439000,
        },
    ]
    (tmp_path / "data" / "scorecard.json").write_text(json.dumps({"rows": rows}))
    top = [
        ["city-of-new-orleans", "City of New Orleans", 37, "government"],
        ["sexton-gloria-m", "Sexton Gloria M", 2, "individual"],
    ]
    ownership = {f"{g['geo_level']}:{g['geo_id']}": _area(100, 30, 5, top) for g in GEOS}
    (tmp_path / "data" / "ownership.json").write_text(json.dumps(ownership))
    return tmp_path


def test_builds_a_page_per_tab_and_area_and_lists_them(dist):
    assert prerender.build(dist) == 1 + 4 + 1 + 4 + 5  # home, markets, ownership + areas, other tabs
    for path in (
        "market/70130",
        "market/jefferson",
        "ownership/70005",
        "ownership/orleans",
        "scorecard",
        "about",
    ):
        assert (dist / path / "index.html").exists(), path
    assert (dist / "404.html").read_text() == SHELL  # any other path opens the plain app
    sitemap = (dist / "sitemap.xml").read_text()
    assert "<loc>https://nolaatlas.com/ownership/70130/</loc>" in sitemap
    assert sitemap.count("<url>") == 15


def test_page_has_its_own_title_canonical_and_readable_content(dist):
    prerender.build(dist)
    page = (dist / "ownership" / "70130" / "index.html").read_text()
    assert "<title>Who owns 70130 · French Quarter &lt;&amp; Lower Garden&gt; · NOLA Atlas</title>" in page
    assert '<link rel="canonical" href="https://nolaatlas.com/ownership/70130/" />' in page
    assert '<meta property="og:url" content="https://nolaatlas.com/ownership/70130/" />' in page
    root = re.search(r'<div id="root">(.*)</div>', page, re.S).group(1)
    assert "<h1>Who owns 70130 · French Quarter &lt;&amp; Lower Garden&gt;</h1>" in root
    assert "City of New Orleans: 37 properties" in root
    assert "Sexton" not in root  # owner lists in pre-built pages name organizations and public bodies
    assert 'href="/market/70130/"' in root and 'href="/ownership/jefferson/"' in root
    market = (dist / "market" / "70130" / "index.html").read_text()
    assert "$525,000" in market and "+3.2%" in market


def test_home_names_the_site_for_search(dist):
    prerender.build(dist)
    home = (dist / "index.html").read_text()
    ld = json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', home).group(1))
    assert ld["@type"] == "WebSite" and ld["name"] == "NOLA Atlas" and ld["url"] == "https://nolaatlas.com/"
    assert "<h1>NOLA Atlas</h1>" in home


def test_a_changed_shell_fails_loudly(dist):
    (dist / "index.html").write_text(
        SHELL.replace('<link rel="canonical" href="https://nolaatlas.com/" />', "")
    )
    with pytest.raises(RuntimeError, match="canonical"):
        prerender.build(dist)


def test_each_page_gets_its_own_preview_image(dist):
    from PIL import Image

    prerender.build(dist)
    page = (dist / "market" / "70130" / "index.html").read_text()
    assert '<meta property="og:image" content="https://nolaatlas.com/og/market-70130.png" />' in page
    assert '<meta name="twitter:image" content="https://nolaatlas.com/og/market-70130.png" />' in page
    assert (
        '<meta name="twitter:title" content="70130 · French Quarter &lt;&amp; Lower Garden&gt; housing market'
        in page
    )
    for name in ("market-70130.png", "ownership-orleans.png", "home.png", "about.png", "default.png"):
        with Image.open(dist / "og" / name) as img:
            assert img.size == (1200, 630), name
    assert (dist / "og" / "default.png").read_bytes() == (dist / "og" / "home.png").read_bytes()


def test_rebuilding_an_already_built_site_starts_from_the_plain_app(dist):
    prerender.build(dist)
    assert prerender.build(dist) == 15
    assert (dist / "404.html").read_text() == SHELL
    assert (dist / "index.html").read_text().count('class="prerender"') == 1
