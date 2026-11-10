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
opens the app. sitemap.xml lists every page here.

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
    "Housing, schools, flood risk and data center power for every address in New Orleans and Metairie: "
    "look up any parcel in Jefferson and Orleans Parish. Free, independent, and built on public records."
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
        ("Properties on the Assessor's roll", f"{s['records']:,}"),
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
    return [
        ("Median sale price", money(row.get("median_sale_price"))),
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
        ("Properties", f"{s['records']:,}"),
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
                ("Gas plants approved for Meta", "3"),
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
    tagline = "Every address in New Orleans and Metairie, explained."
    metro_row = rows.get(metro.key) or {}
    pages = [
        Page(
            "/",
            "NOLA Atlas — Every address in New Orleans and Metairie, explained",
            DEFAULT_DESCRIPTION,
            f"<h1>NOLA Atlas</h1><p><strong>{esc(tagline)}</strong></p>"
            "<p>Four guides to living in New Orleans and Metairie, built on public records: housing, schools, "
            "flood risk, and AI data centers and the power grid. Free and independent.</p>"
            "<h2>Housing</h2><p>Sale prices, home values, rent and inventory for every ZIP, and a report on any "
            "address: its owner, assessed value, flood zone and the true monthly cost to own. "
            f"Metro median sale price: {esc(money(metro_row.get('median_sale_price')) or 'not published')}. "
            '<a href="/market/">Market overview</a> · <a href="/scorecard/">ZIP Scorecard</a> · '
            '<a href="/property/">Property lookup</a> · <a href="/ownership/">Who owns</a></p>'
            f"<h2>Schools</h2><p>Every public and private school in Jefferson and Orleans: open seats, chances of "
            f'getting in, tuition and key dates, on <a href="{SCHOOLS_URL}">NOLA Atlas School Finder</a>.</p>'
            f"<h2>Flood</h2><p>Flood risk for any address, with drainage, levee and storm-surge views and past "
            f'insurance claims nearby, on <a href="{FLOODLENS_URL}">FloodLens</a>.</p>'
            f"<h2>Data center power</h2><p>{esc(power['intro'])} "
            '<a href="/power/">Follow the tracker</a>.</p>'
            f"{market_index}",
            {
                "@context": "https://schema.org",
                "@type": "WebSite",
                "name": "NOLA Atlas",
                "alternateName": ["nolaatlas", "nolaatlas.com"],
                "url": f"{SITE}/",
                "description": DEFAULT_DESCRIPTION,
                "inLanguage": "en-US",
            },
            card=(
                "Free local data for New Orleans and Metairie",
                "Housing, schools, flood and data center power",
                [
                    ("Parcels and condo units", f"{meta.get('property_count', 0):,}"),
                    ("Metro median sale price", money(metro_row.get("median_sale_price"))),
                    ("ZIP codes", f"{sum(a.level == 'zip' for a in areas)}"),
                ],
            ),
        ),
        Page(
            metro.market_path,
            "Housing market · NOLA Atlas",
            f"The {metro.name} housing market: median sale price, home values, rent, days on market, inventory "
            "and months of supply, from Redfin and Zillow, updated monthly.",
            f"<h1>{esc(metro.name)} housing market</h1>{market_facts(metro_row or None)}"
            f'<p><a href="/ownership/">Who owns New Orleans and Metairie</a> · '
            f'<a href="/scorecard/">Compare every ZIP</a></p>{market_index}{owner_index}',
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
                "days on market, inventory and months of supply, from Redfin and Zillow, updated monthly.",
                f"<h1>{esc(a.label)} housing market</h1>{market_facts(row)}"
                f'<p><a href="{a.ownership_path}">Who owns {esc(a.label)}</a> · '
                f'<a href="/scorecard/">Compare every ZIP</a></p>{market_index}',
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
                f"Who owns {a.label}: {s.get('records', 0):,} properties"
                + (f", {org:.0f}% owned by organizations or public bodies" if org is not None else "")
                + ", how many owners hold several, and the largest owners, from the Assessor's roll.",
                f"<h1>Who owns {esc(a.label)}</h1>{ownership_facts(s)}"
                f'<p><a href="{a.market_path}">{esc(a.label)} housing market</a> · '
                f'<a href="/ownership/">All areas</a></p>{owner_index}',
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
            "flood zone, monthly cost, assessment comparison, owner and nearby homes.",
            "<h1>Property lookup for Jefferson and Orleans Parish</h1><p>Search any address, street, owner name, "
            "parcel number or tax bill. Each property shows its FEMA flood zone, the true monthly cost to own, how "
            "its assessment compares with similar homes nearby, its owner and the homes around it on a map. Condo "
            f"buildings list every unit.</p><p>{meta.get('property_count', 0):,} parcels and condo units are on "
            "record.</p>" + market_index,
            card=(
                "Property lookup",
                "Flood zone, monthly cost, assessment and owner for any address",
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
    return pages


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
    body = f'<main class="prerender">{nav()}{page.body}</main>'
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
    return len(pages)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dist", type=Path, default=DIST)
    args = ap.parse_args(argv)
    print(f"Pre-built {build(args.dist)} pages and sitemap.xml in {args.dist}")


if __name__ == "__main__":
    main()
