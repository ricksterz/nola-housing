"""Pre-built HTML pages for search engines, written into the built site after `npm run build`.

The site is one JavaScript app, so every address used to download the same nearly empty
index.html: Google saw the tabs and areas as copies of the home page ("Duplicate, Google chose a
different canonical"). This writes a real page per tab and area at the paths the app uses
(frontend/src/lib/routes.js; keep the two in step):

  /                      the hub                   /market/  /market/{zip|parish}/   market overview
  /scorecard/  /compare/  /macro/  /property/  /power/  /about/
  /ownership/            who owns the metro        /ownership/{zip|parish}/

Each page is the built index.html with its own title, description, canonical and link-preview
tags (and a preview image, etl/og_images.py, at /og/{page}.png), and readable content in place of the empty app root: a heading, the area's numbers from
the exported data, and links to the related pages. The app replaces that content when it loads,
so visitors see the same app as before. 404.html is the plain app shell, so any other path still
opens the app. sitemap.xml lists every page here, and llms.txt describes the site and its pages
for AI search tools (llmstxt.org). Pages carry schema.org JSON-LD: the site and its publisher on the
home page, a Dataset covering the ZIP, parish or metro (as a Place) on market, ownership and
scorecard pages, and a BreadcrumbList everywhere else.

Owner lists name organizations and public bodies only; property and owner pages aren't built. The
data center power page is built from the same hand-kept file the app shows (src/data/power.json).

    python -m etl.prerender [--dist frontend/dist]
"""

import argparse
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from . import config, og_images

SITE = "https://nolaatlas.com"
DIST = config.ETL_DIR.parent / "frontend" / "dist"
DEFAULT_DESCRIPTION = (
    "Type any New Orleans or Metairie address: see who owns it, how it floods, "
    "and which schools are near. Free, independent, and built on public records."
)
POWER = config.ETL_DIR.parent / "frontend" / "src" / "data" / "power.json"
SCHOOLS_URL = "https://schools.nolaatlas.com/"
FLOODLENS_URL = "https://nola-floodlens.onrender.com/"
PARISH_SLUG = {"22051": "jefferson", "22071": "orleans"}


def esc(text) -> str:
    return html.escape(str(text), quote=True)


def money(v) -> str | None:
    return None if v is None else f"${v:,.0f}"


def pct(v, signed: bool = False) -> str | None:
    if v is None:
        return None
    return f"{v:+.1f}%" if signed else f"{v:.1f}%"


def month_label(iso: str | None) -> str:
    if not iso:
        return ""
    return datetime.strptime(iso[:7], "%Y-%m").strftime("%B %Y")


def short_month_label(iso: str | None) -> str:
    """Abbreviated month ("May 2026"), for the preview-card tiles, where a full month overflows
    the 336px tile ("Median sale (May 2026)" measures 288.2px against a 288px limit)."""
    if not iso:
        return ""
    return datetime.strptime(iso[:7], "%Y-%m").strftime("%b %Y")


def source_line(row: dict | None) -> str:
    """How current the market sources are, from the row's own months. Redfin's public feed
    stopped in May 2026, so sale prices carry their vintage instead of "updated monthly"."""
    vintage = month_label(row.get("price_month")) if row else ""
    redfin = f"Sale prices from Redfin through {vintage}" if vintage else "Sale prices from Redfin"
    return f"{redfin}; Zillow values and rents updated monthly."


class Area:
    def __init__(self, geo: dict):
        self.level, self.id, self.name, self.parish = (
            geo["geo_level"],
            geo["geo_id"],
            geo["name"],
            geo["parish"],
        )
        self.key = f"{self.level}:{self.id}"
        self.slug = self.id if self.level == "zip" else PARISH_SLUG.get(self.id)
        # Same as frontend/src/lib/geo.js geoLabel.
        self.label = f"{self.id} · {self.name}" if self.level == "zip" else self.name

    @property
    def market_path(self) -> str:
        return f"/market/{self.slug}/" if self.slug else "/market/"

    @property
    def ownership_path(self) -> str:
        return f"/ownership/{self.slug}/" if self.slug else "/ownership/"


class Page:
    """A pre-built page. ``card`` is its link-preview image: (kicker, headline, [(label, value)])."""

    def __init__(
        self,
        path: str,
        title: str,
        description: str,
        body: str,
        jsonld: dict | None = None,
        card: tuple[str, str, list] | None = None,
    ):
        self.path, self.title, self.description, self.body, self.jsonld = (
            path,
            title,
            description,
            body,
            jsonld,
        )
        self.card = card or ("", title.removesuffix(" · NOLA Atlas"), [])

    @property
    def image(self) -> str:
        """Its preview image's file name under /og/."""
        return (self.path.strip("/").replace("/", "-") or "home") + ".png"


# Structured data (schema.org JSON-LD) for search engines: the site and its publisher on the home
# page; on area pages, a Dataset whose spatialCoverage is the ZIP, parish or metro as a Place; a
# BreadcrumbList on every page but the home page. Facts only: no license, rating or claim the
# page doesn't make.
ORG = {"@type": "Organization", "@id": f"{SITE}/#organization", "name": "NOLA Atlas", "url": f"{SITE}/"}
PUBLISHER = ORG  # in full on every page: a bare @id would point at a node only the home page has
MARKET_SOURCES = [
    {
        "@type": "CreativeWork",
        "name": "Redfin Data Center",
        "url": "https://www.redfin.com/news/data-center/",
    },
    {"@type": "CreativeWork", "name": "Zillow Research", "url": "https://www.zillow.com/research/data/"},
]
ROLL_SOURCES = {
    "jefferson": {
        "@type": "CreativeWork",
        "name": "Jefferson Parish Assessor",
        "url": "https://www.jpassessor.net/",
    },
    "orleans": {
        "@type": "CreativeWork",
        "name": "City of New Orleans parcel records (Orleans Parish Assessor's roll)",
        "url": "https://data.nola.gov/",
    },
}
MARKET_VARIABLES = [
    "Median sale price",
    "Change in median sale price from a year earlier",
    "Typical home value (Zillow ZHVI)",
    "Typical rent (Zillow ZORI)",
    "Homes sold",
    "Median days on market",
    "Active listings",
    "Months of supply",
    "Sale price per square foot",
    "Sale-to-list ratio",
]
OWNERSHIP_VARIABLES = [
    "Records on the Assessor's roll",
    "Owners",
    "Share owned by individuals, organizations and public bodies",
    "Share of properties whose owner holds two or more",
    "Share held by the 10 largest owners",
    "Share of buildings lived in by their owner (homestead)",
]


def place(area: "Area") -> dict:
    """The area a page covers, as schema.org sees it."""
    louisiana = {"@type": "State", "name": "Louisiana"}
    if area.level == "zip":
        parish = {"jefferson": "Jefferson Parish", "orleans": "Orleans Parish"}.get(area.parish)
        return {
            "@type": "Place",
            "name": f"ZIP code {area.id} ({area.name}), Louisiana",
            "address": {
                "@type": "PostalAddress",
                "postalCode": area.id,
                "addressRegion": "LA",
                "addressCountry": "US",
            },
            "containedInPlace": (
                {"@type": "AdministrativeArea", "name": f"{parish}, Louisiana"} if parish else louisiana
            ),
        }
    if area.level == "county":
        return {
            "@type": "AdministrativeArea",
            "name": f"{area.name}, Louisiana",
            "containedInPlace": louisiana,
        }
    return {
        "@type": "Place",
        "name": "New Orleans–Metairie metro area, Louisiana",
        "containedInPlace": louisiana,
    }


def breadcrumbs(*trail: tuple[str, str]) -> dict:
    items = [("NOLA Atlas", "/"), *trail]
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": i, "name": name, "item": f"{SITE}{path}"}
            for i, (name, path) in enumerate(items, 1)
        ],
    }


def dataset(
    name: str, description: str, path: str, area: "Area", variables: list, sources: list, modified: str | None
) -> dict:
    out = {
        "@type": "Dataset",
        "name": name,
        "description": description,
        "url": f"{SITE}{path}",
        "spatialCoverage": place(area),
        "variableMeasured": variables,
        "isBasedOn": sources,
        "creator": PUBLISHER,
        "publisher": PUBLISHER,
        "isAccessibleForFree": True,
        "inLanguage": "en-US",
    }
    if modified:
        out["dateModified"] = modified
    return out


def graph(*nodes: dict) -> dict:
    return {"@context": "https://schema.org", "@graph": list(nodes)}


def nav() -> str:
    links = [
        ("/", "Home"),
        ("/market/", "Market Overview"),
        ("/scorecard/", "ZIP Scorecard"),
        ("/compare/", "Compare"),
        ("/macro/", "Macro"),
        ("/property/", "Property Lookup"),
        ("/ownership/", "Ownership"),
        ("/power/", "AI & Power"),
        ("/about/", "About"),
        (SCHOOLS_URL, "Schools"),
        (FLOODLENS_URL, "Flood"),
    ]
    return (
        '<nav class="prerender-nav">' + " · ".join(f'<a href="{p}">{esc(t)}</a>' for p, t in links) + "</nav>"
    )


def facts(rows: list[tuple[str, str | None]]) -> str:
    items = "".join(f"<dt>{esc(k)}</dt><dd>{esc(v)}</dd>" for k, v in rows if v)
    return f'<dl class="prerender-facts">{items}</dl>' if items else ""


def area_links(areas: list[Area], path_of, heading: str) -> str:
    groups = []
    for parish, label in (("jefferson", "Metairie and East Jefferson"), ("orleans", "New Orleans")):
        links = "".join(
            f'<li><a href="{path_of(a)}">{esc(a.label)}</a></li>'
            for a in areas
            if a.parish == parish and a.level == "zip"
        )
        groups.append(f"<h3>{esc(label)}</h3><ul>{links}</ul>")
    parishes = "".join(
        f'<li><a href="{path_of(a)}">{esc(a.label)}</a></li>' for a in areas if a.level == "county"
    )
    return f"<section><h2>{esc(heading)}</h2><ul>{parishes}</ul>{''.join(groups)}</section>"


def market_facts(row: dict | None) -> str:
    if not row:
        return "<p>Market statistics for this area aren't published yet.</p>"
    return facts(
        [
            (
                f"Median sale price (Redfin, {month_label(row.get('price_month'))})",
                money(row.get("median_sale_price")),
            ),
            ("Change from a year earlier", pct(row.get("price_yoy_pct"), signed=True)),
            (
                f"Typical home value (Zillow ZHVI, {month_label(row.get('zhvi_month'))})",
                money(row.get("zhvi")),
            ),
            ("Typical rent (Zillow ZORI)", f"{money(row['zori'])}/month" if row.get("zori") else None),
            ("Gross rent yield", pct(row.get("gross_yield_pct"))),
            (
                "Homes sold (3-month window)",
                f"{row['homes_sold']:,.0f}" if row.get("homes_sold") is not None else None,
            ),
            (
                "Median days on market",
                f"{row['median_dom']:,.0f}" if row.get("median_dom") is not None else None,
            ),
            (
                "Active listings",
                f"{row['active_listings']:,.0f}" if row.get("active_listings") is not None else None,
            ),
            (
                "Months of supply",
                f"{row['months_supply']:.1f}" if row.get("months_supply") is not None else None,
            ),
            ("Sale price per square foot", money(row.get("price_psf"))),
            ("Sale-to-list ratio", pct(row.get("sale_to_list_ratio"))),
        ]
    )


def ownership_facts(s: dict | None) -> str:
    if not s or not s.get("with_owner"):
        return "<p>No parcels on record for this area.</p>"
    n = s["with_owner"]
    share = lambda k: s["by_kind"].get(k, 0) / n * 100  # noqa: E731
    multi = (s["by_holder_size"].get("2-9", 0) + s["by_holder_size"].get("10+", 0)) / n * 100
    rows = [
        ("Records on the Assessor's roll", f"{s['records']:,}"),
        ("Owners", f"{s['owners']:,}"),
        ("Owned by individuals", pct(share("individual"))),
        ("Owned by organizations", pct(share("organization"))),
        ("Owned by public bodies", pct(share("government"))),
        ("Owner holds two or more properties", pct(multi)),
        ("Held by the 10 largest owners", pct((s.get("top_owners_share") or 0) * 100)),
        (
            "Buildings lived in by their owner (homestead)",
            pct(s["homestead_share"] * 100) if s.get("homestead_share") else None,
        ),
    ]
    top = [r for r in s.get("top_owners", []) if r[3] in ("organization", "government")][:8]
    lst = "".join(f"<li>{esc(name)}: {count:,} properties</li>" for _, name, count, _ in top)
    return facts(rows) + (f"<h2>Largest organization and public owners</h2><ul>{lst}</ul>" if lst else "")


def market_card(row: dict | None) -> list[tuple[str, str | None]]:
    if not row:
        return []
    vintage = short_month_label(row.get("price_month"))
    # Short on purpose: the label shares a 336px tile on the preview image.
    label = f"Median sale {vintage}" if vintage else "Median sale"
    return [
        (label, money(row.get("median_sale_price"))),
        ("Year over year", pct(row.get("price_yoy_pct"), signed=True)),
        ("Typical rent", f"{money(row['zori'])}/mo" if row.get("zori") else None),
    ]


def ownership_card(s: dict | None) -> list[tuple[str, str | None]]:
    if not s or not s.get("with_owner"):
        return []
    n = s["with_owner"]
    org = (s["by_kind"].get("organization", 0) + s["by_kind"].get("government", 0)) / n * 100
    multi = (s["by_holder_size"].get("2-9", 0) + s["by_holder_size"].get("10+", 0)) / n * 100
    return [
        ("Records", f"{s['records']:,}"),
        ("Organizations, public", f"{org:.0f}%"),
        ("Owner holds 2+", f"{multi:.0f}%"),
    ]


def power_page(power: dict) -> Page:
    utilities = "".join(
        f"<li><strong>{esc(u['parish'])}</strong>: {esc(u['utility'])}, regulated by the {esc(u['regulator'])}. "
        f"{esc(u['note'])}</li>"
        for u in power["utilities"]
    )
    projects = "".join(
        f"<h3>{esc(p['name'])}</h3><p>{esc(p['where'])}. {esc(p['power'])}.</p><p>{esc(p['status'])}</p><p>Sources: "
        + " · ".join(f'<a href="{esc(href)}">{esc(label)}</a>' for label, href in p["sources"])
        + "</p>"
        for p in power["projects"]
    )
    timeline = "".join(
        f'<li>{esc(t["date"])}, {esc(t["who"])}: {esc(t["what"])} <a href="{esc(t["source"])}">Source</a></li>'
        for t in power["timeline"]
    )
    bills = "".join(f"<li><strong>{esc(b['side'])}</strong>: {esc(b['text'])}</li>" for b in power["bills"])
    return Page(
        "/power/",
        "AI data centers and power in Louisiana · NOLA Atlas",
        "AI data centers and the gas plants being built for them in Louisiana: Meta's Richland Parish campus, "
        "the LPSC's decisions, New Orleans' pause on data centers, and what it could mean for Entergy bills in "
        "New Orleans and Metairie.",
        f"<h1>AI data centers and Louisiana's power grid</h1><p>{esc(power['intro'])}</p>"
        f"<h2>Who sets your power rates</h2><ul>{utilities}</ul>"
        f"<h2>Projects</h2>{projects}<h2>Decisions so far</h2><ol>{timeline}</ol>"
        f"<p><strong>Next:</strong> {esc(power['next'])}</p>"
        f"<h2>What it could mean for your bill</h2><ul>{bills}</ul>"
        f"<p>Compiled by hand from news reports, company releases and public filings; last checked "
        f"{esc(power['checked'])}.</p>",
        card=(
            "Data center power",
            "Who pays to power Louisiana's data centers?",
            [
                ("Gas plants approved", "3"),
                ("More proposed", "7"),
                ("Last checked", power["checked"]),
            ],
        ),
    )


def build_pages(meta: dict, scorecard: dict, ownership: dict, power: dict) -> list[Page]:
    areas = [Area(g) for g in meta["geos"]]
    metro = next(a for a in areas if a.level == "metro")
    rows = {f"{r['geo_level']}:{r['geo_id']}": r for r in scorecard.get("rows", [])}
    market_index = area_links(
        [a for a in areas if a.level != "metro"], lambda a: a.market_path, "Housing markets by area"
    )
    owner_index = area_links(
        [a for a in areas if a.level != "metro"], lambda a: a.ownership_path, "Who owns each area"
    )
    modified = (meta.get("generated") or "")[:10] or None
    tagline = "Who owns any address, how it floods, and which schools are near."
    metro_row = rows.get(metro.key) or {}
    metro_vintage = month_label(metro_row.get("price_month"))
    pages = [
        Page(
            "/",
            "NOLA Atlas — Look up any New Orleans or Metairie address",
            DEFAULT_DESCRIPTION,
            f"<h1>NOLA Atlas</h1><p><strong>{esc(tagline)}</strong></p>"
            '<p><a href="/property/">Look up any address</a> in Jefferson or Orleans Parish: its owner, '
            "assessed value and yearly property tax, flood zone and flood history, and nearby schools. Built on public "
            "records. Free and independent.</p>"
            "<h2>Homes</h2><p>Sale prices, home values, rent and inventory for 24 ZIPs, and a report on any "
            "address: its owner, assessed value, flood zone and yearly tax and flood insurance. "
            f"Metro median sale price{f' ({metro_vintage})' if metro_vintage else ''}: "
            f"{esc(money(metro_row.get('median_sale_price')) or 'not published')}. "
            '<a href="/market/">Market overview</a> · <a href="/scorecard/">ZIP Scorecard</a> · '
            '<a href="/property/">Property lookup</a> · <a href="/ownership/">Who owns</a></p>'
            f"<h2>Schools</h2><p>Every public and private school in Jefferson and Orleans: open seats, chances of "
            f'getting in, tuition and key dates, on <a href="{SCHOOLS_URL}">NOLA Atlas School Finder</a>.</p>'
            f"<h2>Flood</h2><p>Flood risk for any address, with drainage, levee and storm-surge views and past "
            f'insurance claims nearby, on <a href="{FLOODLENS_URL}">FloodLens</a>.</p>'
            f"<h2>Data center power</h2><p>{esc(power['intro'])} "
            '<a href="/power/">Follow the tracker</a>.</p>'
            f"{market_index}",
            graph(
                {
                    "@type": "WebSite",
                    "@id": f"{SITE}/#website",
                    "name": "NOLA Atlas",
                    "alternateName": ["nolaatlas", "nolaatlas.com"],
                    "url": f"{SITE}/",
                    "description": DEFAULT_DESCRIPTION,
                    "inLanguage": "en-US",
                    "publisher": PUBLISHER,
                },
                {
                    **ORG,
                    "description": "A free, independent reference for homes in New Orleans and Metairie.",
                },
            ),
            card=(
                "Free local data for New Orleans and Metairie",
                "Any address: owner, flood and schools",
                [
                    ("Parcels and condo units", f"{meta.get('property_count', 0):,}"),
                    (
                        f"Median sale {short_month_label(metro_row.get('price_month'))}"
                        if metro_vintage
                        else "Median sale",
                        money(metro_row.get("median_sale_price")),
                    ),
                    ("ZIP codes", f"{sum(a.level == 'zip' for a in areas)}"),
                ],
            ),
        ),
        Page(
            metro.market_path,
            "Housing market · NOLA Atlas",
            f"The {metro.name} housing market: median sale price, home values, rent, days on market, inventory "
            f"and months of supply — {source_line(metro_row)}",
            f"<h1>{esc(metro.name)} housing market</h1>{market_facts(metro_row or None)}"
            f'<p><a href="/ownership/">Who owns New Orleans and Metairie</a> · '
            f'<a href="/scorecard/">Compare every ZIP</a></p>{market_index}{owner_index}',
            graph(
                dataset(
                    f"{metro.name} housing market statistics",
                    f"Monthly housing market statistics for the {metro.name} metro area: median sale price, "
                    f"home values, rent, days on market, inventory and months of supply. {source_line(metro_row)}",
                    metro.market_path,
                    metro,
                    MARKET_VARIABLES,
                    MARKET_SOURCES,
                    modified,
                ),
                breadcrumbs(("Housing market", metro.market_path)),
            ),
            card=("Housing market", "New Orleans and Metairie", market_card(metro_row or None)),
        ),
    ]
    for a in areas:
        if a.level == "metro":
            continue
        row = rows.get(a.key)
        price = money(row.get("median_sale_price")) if row else None
        pages.append(
            Page(
                a.market_path,
                f"{a.label} housing market · NOLA Atlas",
                f"{a.label} housing market: median sale price{f' {price}' if price else ''}, home values, rent, "
                f"days on market, inventory and months of supply — {source_line(row)}",
                f"<h1>{esc(a.label)} housing market</h1>{market_facts(row)}"
                f'<p><a href="{a.ownership_path}">Who owns {esc(a.label)}</a> · '
                f'<a href="/scorecard/">Compare every ZIP</a></p>{market_index}',
                graph(
                    dataset(
                        f"{a.label} housing market statistics",
                        f"Monthly housing market statistics for {a.label}: median sale price, home values, rent, "
                        f"days on market, inventory and months of supply. {source_line(row)}",
                        a.market_path,
                        a,
                        MARKET_VARIABLES,
                        MARKET_SOURCES,
                        modified,
                    ),
                    breadcrumbs(("Housing market", metro.market_path), (a.label, a.market_path)),
                ),
                card=("Housing market", a.label, market_card(row)),
            )
        )
    pages.append(
        Page(
            "/ownership/",
            "Who owns New Orleans and Metairie · NOLA Atlas",
            "Who owns property in Jefferson and Orleans Parish: individuals, organizations and public bodies, "
            "how many owners hold several properties, and the largest owners, from the Assessors' rolls.",
            f"<h1>Who owns New Orleans and Metairie</h1>{ownership_facts(ownership.get(metro.key))}{owner_index}",
            graph(
                dataset(
                    "Property ownership in New Orleans and Metairie",
                    "Who owns property in Jefferson and Orleans Parish, from the Assessors' rolls: individuals, "
                    "organizations and public bodies, owners holding several properties, the largest owners, and "
                    "the share of homes lived in by their owner.",
                    "/ownership/",
                    metro,
                    OWNERSHIP_VARIABLES,
                    list(ROLL_SOURCES.values()),
                    modified,
                ),
                breadcrumbs(("Who owns", "/ownership/")),
            ),
            card=("Who owns", "New Orleans and Metairie", ownership_card(ownership.get(metro.key))),
        )
    )
    for a in areas:
        if a.level == "metro":
            continue
        s = ownership.get(a.key) or {}
        org = None
        if s.get("with_owner"):
            org = (
                (s["by_kind"].get("organization", 0) + s["by_kind"].get("government", 0))
                / s["with_owner"]
                * 100
            )
        pages.append(
            Page(
                a.ownership_path,
                f"Who owns {a.label} · NOLA Atlas",
                f"Who owns {a.label}: {s.get('records', 0):,} records"
                + (f", {org:.0f}% owned by organizations or public bodies" if org is not None else "")
                + ", how many owners hold several, and the largest owners, from the Assessor's roll.",
                f"<h1>Who owns {esc(a.label)}</h1>{ownership_facts(s)}"
                f'<p><a href="{a.market_path}">{esc(a.label)} housing market</a> · '
                f'<a href="/ownership/">All areas</a></p>{owner_index}',
                graph(
                    dataset(
                        f"Property ownership in {a.label}",
                        f"Who owns property in {a.label}, from the Assessor's roll: individuals, organizations "
                        "and public bodies, owners holding several properties, the largest owners, and the share "
                        "of homes lived in by their owner.",
                        a.ownership_path,
                        a,
                        OWNERSHIP_VARIABLES,
                        [ROLL_SOURCES[a.parish]] if a.parish in ROLL_SOURCES else list(ROLL_SOURCES.values()),
                        modified,
                    ),
                    breadcrumbs(("Who owns", "/ownership/"), (a.label, a.ownership_path)),
                ),
                card=("Who owns", a.label, ownership_card(s)),
            )
        )
    table_rows = "".join(
        f'<tr><td><a href="{a.market_path}">{esc(a.label)}</a></td>'
        f"<td>{esc(money(rows[a.key].get('median_sale_price')) or '—')}</td>"
        f"<td>{esc(pct(rows[a.key].get('price_yoy_pct'), signed=True) or '—')}</td>"
        f"<td>{esc(money(rows[a.key].get('zhvi')) or '—')}</td>"
        f"<td>{esc(money(rows[a.key].get('zori')) or '—')}</td>"
        f"<td>{esc(rows[a.key].get('median_dom') or '—')}</td></tr>"
        for a in areas
        if a.level == "zip" and a.key in rows
    )
    pages += [
        Page(
            "/scorecard/",
            "ZIP Scorecard · NOLA Atlas",
            "Every New Orleans and Metairie ZIP code side by side: median sale price, year-over-year change, home "
            "value, rent, days on market and gross rent yield.",
            "<h1>ZIP Scorecard: New Orleans and Metairie ZIP codes side by side</h1>"
            "<table><thead><tr><th>ZIP</th><th>Median sale price</th><th>Year over year</th><th>Home value (ZHVI)"
            f"</th><th>Rent (ZORI)</th><th>Days on market</th></tr></thead><tbody>{table_rows}</tbody></table>",
            graph(
                dataset(
                    "New Orleans and Metairie ZIP code housing scorecard",
                    "Every New Orleans and Metairie ZIP code side by side: median sale price, year-over-year "
                    "change, home value, rent, days on market and gross rent yield.",
                    "/scorecard/",
                    metro,
                    [*MARKET_VARIABLES, "Gross rent yield"],
                    MARKET_SOURCES,
                    modified,
                ),
                breadcrumbs(("ZIP Scorecard", "/scorecard/")),
            ),
            card=("ZIP Scorecard", "New Orleans and Metairie ZIP codes side by side", []),
        ),
        Page(
            "/compare/",
            "Compare areas · NOLA Atlas",
            "Compare New Orleans and Metairie ZIP codes and parishes on one housing metric over time.",
            "<h1>Compare New Orleans and Metairie areas</h1><p>Overlay up to six ZIP codes or parishes on one "
            "housing metric (home value, sale price, rent, days on market, inventory) and index them to 100.</p>"
            + market_index,
        ),
        Page(
            "/macro/",
            "Macro trends · NOLA Atlas",
            "The New Orleans metro housing market against mortgage rates and house price indexes from FRED.",
            "<h1>Macro trends for the New Orleans metro</h1><p>Metro and parish home values and rents indexed side "
            "by side, the 30-year mortgage rate, FHFA house price indexes and realtor.com listing series.</p>",
        ),
        Page(
            "/property/",
            "Property Lookup · NOLA Atlas",
            "Look up any parcel in Jefferson and Orleans Parish by address, street, owner name or parcel number: "
            "flood zone, yearly tax and flood insurance, assessment comparison, owner and nearby homes.",
            "<h1>Property lookup for Jefferson and Orleans Parish</h1><p>Search any address, street, owner name, "
            "parcel number or tax bill. Each property shows its FEMA flood zone, its yearly property tax and flood insurance, how "
            "its assessment compares with similar homes nearby, its owner and the homes around it on a map. Condo "
            f"buildings list every unit.</p><p>{meta.get('property_count', 0):,} parcels and condo units are on "
            "record.</p>" + market_index,
            card=(
                "Property lookup",
                "Owner, flood zone, assessment and yearly tax for any address",
                [("Parcels and condo units", f"{meta.get('property_count', 0):,}")],
            ),
        ),
        power_page(power),
        Page(
            "/about/",
            "About and methodology · NOLA Atlas",
            "How NOLA Atlas works: sources (the Jefferson and Orleans Parish Assessors, the City of New Orleans, "
            "FEMA, Redfin, Zillow and FRED), methods and limits.",
            "<h1>About NOLA Atlas</h1><p>NOLA Atlas is an independent, free site built on public records. Parcel "
            "records and owner names come from the Jefferson Parish Assessor, the Orleans Parish Assessor and the "
            "City of New Orleans; flood zones from FEMA; market statistics from Redfin, Zillow and FRED.</p><p>Owner "
            "names and property records are shown as published, without verification, and aren't proof of "
            "ownership. Nothing on the site is financial, legal or tax advice.</p>",
        ),
    ]
    # The tab pages without a dataset still say where they sit in the site.
    for page in pages:
        if page.jsonld is None and page.path != "/":
            page.jsonld = graph(breadcrumbs((page.title.removesuffix(" · NOLA Atlas"), page.path)))
    return pages


# On every pre-built page, under its content: the short form of the app's footer disclaimer.
NOTICE = (
    '<p class="prerender-notice"><small>For general information only, not financial, legal, tax or insurance '
    "advice, an appraisal or proof of ownership. Owner names and parcel records are shown as published in public "
    "records and aren't verified. NOLA Atlas is independent and not affiliated with the Assessors, the City, FEMA "
    'or any data provider. <a href="/about/">Sources and methods</a>.</small></p>'
)


def render(shell: str, page: Page) -> str:
    url = f"{SITE}{page.path}"
    image = f"{SITE}/og/{page.image}"
    out = shell
    swaps = [
        (r"<title>.*?</title>", f"<title>{esc(page.title)}</title>"),
        (
            r'<meta name="description" content="[^"]*"\s*/?>',
            f'<meta name="description" content="{esc(page.description)}" />',
        ),
        (r'<link rel="canonical" href="[^"]*"\s*/?>', f'<link rel="canonical" href="{url}" />'),
        (
            r'<meta property="og:title" content="[^"]*"\s*/?>',
            f'<meta property="og:title" content="{esc(page.title)}" />',
        ),
        (
            r'<meta property="og:description" content="[^"]*"\s*/?>',
            f'<meta property="og:description" content="{esc(page.description)}" />',
        ),
        (r'<meta property="og:url" content="[^"]*"\s*/?>', f'<meta property="og:url" content="{url}" />'),
        (
            r'<meta property="og:image" content="[^"]*"\s*/?>',
            f'<meta property="og:image" content="{image}" />',
        ),
        (
            r'<meta property="og:image:alt" content="[^"]*"\s*/?>',
            f'<meta property="og:image:alt" content="{esc(page.card[1])}, on NOLA Atlas" />',
        ),
        (
            r'<meta name="twitter:title" content="[^"]*"\s*/?>',
            f'<meta name="twitter:title" content="{esc(page.title)}" />',
        ),
        (
            r'<meta name="twitter:description" content="[^"]*"\s*/?>',
            f'<meta name="twitter:description" content="{esc(page.description)}" />',
        ),
        (
            r'<meta name="twitter:image" content="[^"]*"\s*/?>',
            f'<meta name="twitter:image" content="{image}" />',
        ),
    ]
    for pattern, replacement in swaps:
        out, n = re.subn(pattern, lambda _m, r=replacement: r, out, count=1, flags=re.S)
        if n != 1:
            raise RuntimeError(f"index.html has no tag matching {pattern}")
    if page.jsonld:
        ld = json.dumps(page.jsonld, ensure_ascii=False).replace("</", "<\\/")
        out = out.replace("</head>", f'  <script type="application/ld+json">{ld}</script>\n  </head>', 1)
    body = f'<main class="prerender">{nav()}{page.body}{NOTICE}</main>'
    out, n = re.subn(r'<div id="root"></div>', lambda _m: f'<div id="root">{body}</div>', out, count=1)
    if n != 1:
        raise RuntimeError('index.html has no empty <div id="root"></div>')
    return out


def write_sitemap(pages: list[Page], path: Path) -> None:
    today = datetime.now(timezone.utc).date().isoformat()
    urls = "".join(f"  <url><loc>{esc(SITE + p.path)}</loc><lastmod>{today}</lastmod></url>\n" for p in pages)
    path.write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + urls
        + "</urlset>\n"
    )


def llms_txt(pages: list[Page], meta: dict) -> str:
    """/llms.txt (llmstxt.org): what the site is and which page answers what, for AI search tools.
    Lookups of single addresses and owners are made in the browser, so they're described, not listed."""
    by_path = {p.path: p for p in pages}

    def line(p: Page) -> str:
        return f"- [{p.title.removesuffix(' · NOLA Atlas')}]({SITE}{p.path}): {p.description}"

    tabs = ["/property/", "/market/", "/scorecard/", "/compare/", "/macro/", "/ownership/", "/power/"]
    markets = [p for p in pages if p.path.startswith("/market/") and p.path != "/market/"]
    owners = [p for p in pages if p.path.startswith("/ownership/") and p.path != "/ownership/"]
    count = meta.get("property_count") or 0
    out = [
        "# NOLA Atlas",
        "",
        "> A free, independent reference for homes in New Orleans and Metairie (Orleans and Jefferson "
        "Parish, Louisiana), built on public records: who owns a property, its assessed value and "
        "yearly property tax, its FEMA flood zone, nearby schools, and housing-market statistics for "
        "24 ZIP codes.",
        "",
        f"- Property Lookup covers {count:,} parcels and condo units. A report for one address opens at "
        f"{SITE}/property/?q=<address> (for example {SITE}/property/?q=1+Poydras+St) and is built in the "
        "browser from the exported data.",
        "- Sources: the Jefferson Parish Assessor, the City of New Orleans (the Orleans Parish Assessor's "
        "roll), FEMA's National Flood Hazard Layer, OpenFEMA flood insurance policies, the Census ACS, "
        "Redfin, Zillow and FRED. Orleans parcels have owners but no assessed values or sale prices yet.",
        "- Owner names and parcel records are shown as published, unverified, and aren't proof of "
        "ownership. Nothing here is financial, legal, tax or insurance advice, an appraisal or an "
        "insurance quote.",
        "",
        "## Main pages",
        "",
        *(line(by_path[p]) for p in tabs if p in by_path),
        "",
        "## Housing market by area",
        "",
        *(line(p) for p in markets),
        "",
        "## Who owns each area",
        "",
        *(line(p) for p in owners),
        "",
        "## Related sites",
        "",
        f"- [NOLA Atlas School Finder]({SCHOOLS_URL}): every public and private school in Jefferson and "
        "Orleans, with open seats, admission chances, tuition and key dates.",
        f"- [FloodLens]({FLOODLENS_URL}): flood risk for any Louisiana address, with drainage, levee and "
        "storm-surge views and past insurance claims nearby.",
        "",
        "## Optional",
        "",
        *([line(by_path["/about/"])] if "/about/" in by_path else []),
        f"- [Sitemap]({SITE}/sitemap.xml): every pre-built page.",
        "",
    ]
    return "\n".join(out)


def build(dist: Path = DIST) -> int:
    shell = (dist / "index.html").read_text()
    if '<div id="root"></div>' not in shell and (dist / "404.html").exists():
        shell = (dist / "404.html").read_text()  # already pre-built: start again from the plain app
    if '<div id="root"></div>' not in shell:
        raise RuntimeError(f"{dist} has no plain app shell (index.html or 404.html with an empty root)")
    data = dist / "data"
    meta = json.loads((data / "meta.json").read_text())
    scorecard = json.loads((data / "scorecard.json").read_text())
    ownership = (
        json.loads((data / "ownership.json").read_text()) if (data / "ownership.json").exists() else {}
    )
    pages = build_pages(meta, scorecard, ownership, json.loads(POWER.read_text()))
    (dist / "404.html").write_text(shell)  # any other path still opens the app
    for page in pages:
        og_images.card(dist / "og" / page.image, page.card[1], page.card[0], page.card[2], page.description)
    # The default image (the shell's own tags: lookups and any other link) is the home page's.
    (dist / "og" / "default.png").write_bytes((dist / "og" / "home.png").read_bytes())
    for page in pages:
        target = dist / page.path.strip("/") / "index.html" if page.path != "/" else dist / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(render(shell, page))
    write_sitemap(pages, dist / "sitemap.xml")
    (dist / "llms.txt").write_text(llms_txt(pages, meta))
    return len(pages)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dist", type=Path, default=DIST)
    args = ap.parse_args(argv)
    print(f"Pre-built {build(args.dist)} pages, sitemap.xml and llms.txt in {args.dist}")


if __name__ == "__main__":
    main()
