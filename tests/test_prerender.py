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
    assert prerender.build(dist) == 1 + 1 + 4 + 1 + 4 + 6  # hub, markets, ownership + areas, tabs
    for path in (
        "market",
        "market/70130",
        "market/jefferson",
        "ownership/70005",
        "ownership/orleans",
        "scorecard",
        "power",
        "about",
    ):
        assert (dist / path / "index.html").exists(), path
    assert (dist / "404.html").read_text() == SHELL  # any other path opens the plain app
    sitemap = (dist / "sitemap.xml").read_text()
    assert "<loc>https://nolaatlas.com/ownership/70130/</loc>" in sitemap
    assert sitemap.count("<url>") == 17


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


def test_every_page_carries_the_disclaimer(dist):
    prerender.build(dist)
    for page in dist.rglob("index.html"):
        root = re.search(r'<div id="root">(.*)</div>', page.read_text(), re.S).group(1)
        assert "not financial, legal, tax or insurance advice" in root, page
        assert "proof of ownership" in root and 'href="/about/"' in root, page


def _jsonld(page: str) -> dict:
    return json.loads(re.search(r'<script type="application/ld\+json">(.*?)</script>', page).group(1))


def _node(ld: dict, kind: str) -> dict:
    [node] = [n for n in ld["@graph"] if n["@type"] == kind]
    return node


def test_home_names_the_site_for_search(dist):
    prerender.build(dist)
    home = (dist / "index.html").read_text()
    ld = _jsonld(home)
    site = _node(ld, "WebSite")
    assert site["name"] == "NOLA Atlas" and site["url"] == "https://nolaatlas.com/"
    assert site["publisher"]["@id"] == "https://nolaatlas.com/#organization"
    assert _node(ld, "Organization")["@id"] == "https://nolaatlas.com/#organization"
    assert "<h1>NOLA Atlas</h1>" in home
    for link in ('href="/market/"', 'href="/power/"', "schools.nolaatlas.com", "nola-floodlens.onrender.com"):
        assert link in home, link  # the hub links every topic


def test_metro_market_moves_to_market_and_power_page_lists_its_sources(dist):
    prerender.build(dist)
    market = (dist / "market" / "index.html").read_text()
    assert '<link rel="canonical" href="https://nolaatlas.com/market/" />' in market
    assert "<h1>New Orleans-Metairie, LA housing market</h1>" in market and "$355,000" in market
    power = (dist / "power" / "index.html").read_text()
    assert "<h1>AI data centers and Louisiana's power grid</h1>" in power
    assert "Louisiana Public Service Commission" in power and 'href="https://www.wwno.org/' in power


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
    assert prerender.build(dist) == 17
    assert (dist / "404.html").read_text() == SHELL
    assert (dist / "index.html").read_text().count('class="prerender"') == 1


def test_sale_prices_carry_their_vintage(dist):
    # Redfin's public feed stopped in May 2026: sale prices carry their vintage instead of
    # "updated monthly", on the page, in its description and on the preview card.
    assert prerender.source_line({"price_month": "2026-05-01"}) == (
        "Sale prices from Redfin through May 2026; Zillow values and rents updated monthly."
    )
    assert prerender.source_line({}) == "Sale prices from Redfin; Zillow values and rents updated monthly."
    assert prerender.source_line(None) == "Sale prices from Redfin; Zillow values and rents updated monthly."
    assert prerender.market_card({"median_sale_price": 355000, "price_month": "2026-05-01"})[0] == (
        "Median sale May 2026",
        "$355,000",
    )
    assert prerender.market_card({"median_sale_price": 355000})[0][0] == "Median sale"
    prerender.build(dist)
    home = (dist / "index.html").read_text()
    assert "Metro median sale price (May 2026): $355,000" in home
    market = (dist / "market" / "index.html").read_text()
    assert "Sale prices from Redfin through May 2026; Zillow values and rents updated monthly" in market
    assert "from Redfin and Zillow, updated monthly" not in market
    area = (dist / "market" / "70130" / "index.html").read_text()
    assert "Sale prices from Redfin; Zillow values and rents updated monthly" in area


def test_area_pages_describe_their_data_and_place_for_search(dist):
    prerender.build(dist)
    ld = _jsonld((dist / "market" / "70130" / "index.html").read_text())
    data = _node(ld, "Dataset")
    assert data["name"] == "70130 · French Quarter <& Lower Garden> housing market statistics"
    assert data["url"] == "https://nolaatlas.com/market/70130/"
    place = data["spatialCoverage"]
    assert place["address"]["postalCode"] == "70130"
    assert place["containedInPlace"]["name"] == "Orleans Parish, Louisiana"
    assert {s["name"] for s in data["isBasedOn"]} == {"Redfin Data Center", "Zillow Research"}
    assert data["creator"]["name"] == "NOLA Atlas"  # named in full: the home page's node isn't on this page
    crumbs = [i["item"] for i in _node(ld, "BreadcrumbList")["itemListElement"]]
    assert crumbs == [
        "https://nolaatlas.com/",
        "https://nolaatlas.com/market/",
        "https://nolaatlas.com/market/70130/",
    ]

    owners = _node(_jsonld((dist / "ownership" / "jefferson" / "index.html").read_text()), "Dataset")
    assert owners["spatialCoverage"] == {
        "@type": "AdministrativeArea",
        "name": "Jefferson Parish, Louisiana",
        "containedInPlace": {"@type": "State", "name": "Louisiana"},
    }
    assert [s["name"] for s in owners["isBasedOn"]] == ["Jefferson Parish Assessor"]
    # A script tag can't be closed early by text inside the data.
    assert (
        "</script>"
        not in (dist / "market" / "70130" / "index.html")
        .read_text()
        .split("ld+json")[1]
        .split("</script>")[0]
    )

    # Every other pre-built page at least says where it sits.
    about = _jsonld((dist / "about" / "index.html").read_text())
    assert [i["name"] for i in _node(about, "BreadcrumbList")["itemListElement"]] == [
        "NOLA Atlas",
        "About and methodology",
    ]


def test_llms_txt_describes_the_site_and_lists_its_pages(dist):
    prerender.build(dist)
    text = (dist / "llms.txt").read_text()
    assert text.startswith("# NOLA Atlas\n\n> A free, independent reference for homes in New Orleans")
    assert "## Main pages" in text and "## Housing market by area" in text and "## Who owns each area" in text
    assert "- [Property Lookup](https://nolaatlas.com/property/): " in text
    assert (
        "(https://nolaatlas.com/market/70005/)" in text
        and "(https://nolaatlas.com/ownership/orleans/)" in text
    )
    assert "305,869 parcels and condo units" in text
    assert ".." not in text.replace("...", "")
    assert "schools.nolaatlas.com" in text and "https://nolaatlas.com/sitemap.xml" in text
    assert (
        "aren't proof of ownership" in text
        and "Nothing here is financial, legal, tax or insurance advice" in text
    )
