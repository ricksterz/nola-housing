"""Read-side queries over nola_housing.duckdb shared by the API routers and the static export.

Everything is keyed by the normalized (geo_level, geo_id) the ETL produces:
zip -> 5-digit ZIP, county -> parish FIPS, metro -> CBSA 35380.
"""

import json
import re
from datetime import date

from etl import config

TREND_COLUMNS = [
    "month",
    "redfin_median_sale_price",
    "redfin_homes_sold",
    "redfin_median_dom",
    "redfin_active_listings",
    "redfin_new_listings",
    "redfin_pending_sales",
    "redfin_months_supply",
    "redfin_median_sale_price_psf",
    "redfin_sale_to_list_ratio",
    "redfin_pct_sold_above_list",
    "redfin_pct_price_drops",
    "redfin_pct_off_market_2wk",
    "zhvi",
    "zori",
]

ZIP_NAMES = {
    "70001": "Metairie",
    "70002": "Metairie",
    "70003": "Metairie",
    "70005": "Old Metairie",
    "70006": "Metairie",
    "70121": "Old Jefferson",
    "70123": "Harahan / River Ridge",
    "70112": "CBD / Tulane-Gravier",
    "70113": "Central City",
    "70114": "Algiers",
    "70115": "Uptown / Garden District",
    "70116": "Marigny / Tremé",
    "70117": "Bywater / Upper 9th",
    "70118": "Carrollton / Uptown",
    "70119": "Mid-City / Bayou St. John",
    "70122": "Gentilly",
    "70124": "Lakeview / Lakeshore",
    "70125": "Broadmoor / Gert Town",
    "70126": "Gentilly East",
    "70127": "New Orleans East",
    "70128": "New Orleans East",
    "70129": "Village de l'Est",
    "70130": "French Quarter / Lower Garden",
    "70131": "Algiers / English Turn",
}


def _rows(con, sql, params=()):
    cur = con.execute(sql, params)
    cols = [c[0] for c in cur.description]
    out = []
    for row in cur.fetchall():
        rec = {}
        for k, v in zip(cols, row, strict=True):
            if v is None:
                continue
            rec[k] = v.isoformat() if hasattr(v, "isoformat") else v
        out.append(rec)
    return out


def _table_exists(con, name):
    return (
        con.execute("SELECT COUNT(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[
            0
        ]
        > 0
    )


def geo_name(geo_level: str, geo_id: str) -> str:
    if geo_level == "zip":
        return ZIP_NAMES.get(geo_id, f"ZIP {geo_id}")
    if geo_level == "county":
        return config.PARISHES[config.FIPS_TO_PARISH[geo_id]]["name"]
    return config.CBSA_NAME


def geos() -> list[dict]:
    """Every geography the app exposes, in display order."""
    out = [{"geo_level": "metro", "geo_id": config.CBSA_CODE, "name": config.CBSA_NAME, "parish": None}]
    for parish, meta in config.PARISHES.items():
        out.append({"geo_level": "county", "geo_id": meta["fips"], "name": meta["name"], "parish": parish})
        for z in config.ZIPS_BY_PARISH[parish]:
            out.append({"geo_level": "zip", "geo_id": z, "name": ZIP_NAMES.get(z, z), "parish": parish})
    return out


def trend(con, geo_level: str, geo_id: str) -> dict:
    cols = ", ".join(TREND_COLUMNS)
    series = _rows(
        con,
        f"SELECT {cols} FROM market_monthly WHERE geo_level = ? AND geo_id = ? ORDER BY month",
        [geo_level, geo_id],
    )
    return {"geo_level": geo_level, "geo_id": geo_id, "name": geo_name(geo_level, geo_id), "series": series}


def compare(con) -> dict:
    return {"geos": {g["geo_id"]: trend(con, g["geo_level"], g["geo_id"])["series"] for g in geos()}}


_SCORECARD_SQL = """
WITH m AS (
    SELECT geo_level, geo_id, month,
           redfin_median_sale_price AS price, redfin_homes_sold AS sold, redfin_median_dom AS dom,
           redfin_active_listings AS active, redfin_months_supply AS mos,
           redfin_median_sale_price_psf AS psf, redfin_sale_to_list_ratio AS stl,
           redfin_pct_price_drops AS drops, redfin_new_listings AS new_listings, zhvi, zori
    FROM market_monthly
),
latest AS (
    SELECT geo_level, geo_id, MAX(month) FILTER (WHERE price IS NOT NULL) AS price_month,
           MAX(month) FILTER (WHERE zhvi IS NOT NULL) AS zhvi_month,
           MAX(month) FILTER (WHERE zori IS NOT NULL) AS zori_month
    FROM m GROUP BY 1, 2
),
cur AS (
    SELECT l.geo_level, l.geo_id, l.price_month, l.zhvi_month, l.zori_month,
           p.price, p.sold, p.dom, p.active, p.mos, p.psf, p.stl, p.drops, p.new_listings,
           z.zhvi, r.zori
    FROM latest l
    LEFT JOIN m p ON p.geo_level = l.geo_level AND p.geo_id = l.geo_id AND p.month = l.price_month
    LEFT JOIN m z ON z.geo_level = l.geo_level AND z.geo_id = l.geo_id AND z.month = l.zhvi_month
    LEFT JOIN m r ON r.geo_level = l.geo_level AND r.geo_id = l.geo_id AND r.month = l.zori_month
),
prior AS (
    SELECT c.geo_level, c.geo_id,
           p.price AS price_yago, p.sold AS sold_yago, p.dom AS dom_yago, p.active AS active_yago,
           p.psf AS psf_yago, z.zhvi AS zhvi_yago, r.zori AS zori_yago
    FROM cur c
    LEFT JOIN m p ON p.geo_level = c.geo_level AND p.geo_id = c.geo_id
                 AND p.month = c.price_month - INTERVAL 12 MONTH
    LEFT JOIN m z ON z.geo_level = c.geo_level AND z.geo_id = c.geo_id
                 AND z.month = c.zhvi_month - INTERVAL 12 MONTH
    LEFT JOIN m r ON r.geo_level = c.geo_level AND r.geo_id = c.geo_id
                 AND r.month = c.zori_month - INTERVAL 12 MONTH
),
spark AS (
    SELECT geo_level, geo_id,
           list(price ORDER BY month)
               FILTER (WHERE price IS NOT NULL AND month >= current_date - INTERVAL 24 MONTH) AS spark_price,
           list(zhvi ORDER BY month)
               FILTER (WHERE zhvi IS NOT NULL AND month >= current_date - INTERVAL 24 MONTH) AS spark_zhvi,
           list(active ORDER BY month)
               FILTER (WHERE active IS NOT NULL AND month >= current_date - INTERVAL 24 MONTH) AS spark_active
    FROM m GROUP BY 1, 2
)
SELECT c.geo_level, c.geo_id, g.parish_fips, g.cbsa,
       c.price_month, c.zhvi_month, c.zori_month,
       c.price AS median_sale_price,
       CASE WHEN p.price_yago > 0 THEN (c.price / p.price_yago - 1) * 100 END AS price_yoy_pct,
       c.zhvi, CASE WHEN p.zhvi_yago > 0 THEN (c.zhvi / p.zhvi_yago - 1) * 100 END AS zhvi_yoy_pct,
       c.zori, CASE WHEN p.zori_yago > 0 THEN (c.zori / p.zori_yago - 1) * 100 END AS zori_yoy_pct,
       CASE WHEN c.zhvi > 0 AND c.zori > 0 THEN c.zori * 12.0 / c.zhvi * 100 END AS gross_yield_pct,
       c.sold AS homes_sold,
       CASE WHEN p.sold_yago > 0 THEN (c.sold / p.sold_yago - 1) * 100 END AS sold_yoy_pct,
       c.dom AS median_dom, c.dom - p.dom_yago AS dom_yoy_delta,
       c.active AS active_listings,
       CASE WHEN p.active_yago > 0 THEN (c.active / p.active_yago - 1) * 100 END AS active_yoy_pct,
       c.new_listings, c.mos AS months_supply, c.psf AS price_psf,
       CASE WHEN p.psf_yago > 0 THEN (c.psf / p.psf_yago - 1) * 100 END AS psf_yoy_pct,
       c.stl AS sale_to_list_ratio, c.drops AS pct_price_drops,
       s.spark_price, s.spark_zhvi, s.spark_active
FROM cur c
LEFT JOIN prior p USING (geo_level, geo_id)
LEFT JOIN spark s USING (geo_level, geo_id)
LEFT JOIN geo_dim g USING (geo_level, geo_id)
ORDER BY c.geo_level, c.geo_id
"""


def scorecard(con) -> dict:
    rows = _rows(con, _SCORECARD_SQL)
    parish_of = {g["geo_id"]: g["parish"] for g in geos()}
    for r in rows:
        r["name"] = geo_name(r["geo_level"], r["geo_id"])
        r["parish"] = parish_of.get(r["geo_id"])
        for k in ("spark_price", "spark_zhvi", "spark_active"):
            r[k] = [round(v) for v in (r.get(k) or [])]
        for k, v in list(r.items()):
            if isinstance(v, float):
                r[k] = round(v, 2)
    return {"rows": rows}


def macro_index(con) -> list[dict]:
    if not _table_exists(con, "macro_index"):
        return []
    return _rows(con, "SELECT * FROM macro_index WHERE date >= '2000-01-01' ORDER BY date")


def macro_snapshot(con) -> dict:
    """Latest per-series values as stored by the FRED loader (Houston macro.json shape)."""
    if not _table_exists(con, "macro_snapshot"):
        return {}
    row = con.execute("SELECT snapshot FROM macro_snapshot ORDER BY fetched_at DESC LIMIT 1").fetchone()
    return json.loads(row[0]) if row else {}


def normalize_address(addr: str) -> str:
    addr = addr.split(",")[0]  # tolerate a full "street, city, state zip" being passed back in
    return re.sub(r"\s+", " ", addr.strip().upper())


def slugify(address: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", address.strip().lower()).strip("-")


_ORDINAL = re.compile(r"^(\d+)(st|nd|rd|th)$", re.IGNORECASE)


def _title_case_address(s: str) -> str:
    """str.title() capitalizes after every non-letter, so "2ND AVE" -> "2Nd Ave"; keep
    ordinal suffixes lowercase ("2nd Ave") since that's the only address-specific case
    naive title-casing gets wrong here."""
    words = []
    for w in s.split(" "):
        m = _ORDINAL.match(w)
        words.append(m.group(1) + m.group(2).lower() if m else w.title())
    return " ".join(words)


def full_address(parcel: dict) -> str:
    """Title-cased street, plus city/state/ZIP when the geocoded fields are known."""
    addr = _title_case_address(parcel.get("site_address") or parcel.get("site_address_norm") or "")
    city = parcel.get("city")
    zip_code = parcel.get("zip_code")
    if city and zip_code:
        return f"{addr}, {city}, LA {zip_code}"
    if city:
        return f"{addr}, {city}, LA"
    return addr


def property_lookup(con, address: str) -> dict | None:
    needle = normalize_address(address)
    rows = _rows(con, "SELECT * FROM parcel_market WHERE site_address_norm = ? LIMIT 1", [needle])
    if not rows:
        rows = _rows(
            con,
            "SELECT * FROM parcel_market WHERE site_address_norm LIKE ? ORDER BY site_address_norm LIMIT 1",
            [f"{needle}%"],
        )
    if not rows:
        rows = _rows(
            con,
            "SELECT * FROM parcel_market WHERE site_address_norm LIKE ? ORDER BY site_address_norm LIMIT 1",
            [f"%{needle}%"],
        )
    if not rows:
        return None
    parcel = rows[0]
    parcel["full_address"] = full_address(parcel)
    history = _rows(
        con,
        """SELECT tax_year, land_val, bld_val, tot_mkt_val, assessed_val, homestead_exempt_val, taxable_val
           FROM assessed_value_history WHERE parish = ? AND parcel_id = ? ORDER BY tax_year""",
        [parcel["parish"], parcel["parcel_id"]],
    )
    parcel.pop("assessed_value_history", None)
    return {"parcel": parcel, "value_history": history, "valuation": implied_valuation(con, parcel)}


def implied_valuation(con, parcel: dict) -> dict | None:
    """Indicative value from the ZIP's Redfin median $/sqft, ranged by the last 12 months of $/sqft.

    There is no MLS leg for New Orleans, so this stands in for the Houston comps model until one
    exists. It is a market-level indicator scaled to the home's size, not a comps-based estimate.
    """
    sqft = parcel.get("building_area")
    zip_code = parcel.get("zip_code")
    if not sqft or not zip_code:
        return None
    row = con.execute(
        """SELECT quantile_cont(redfin_median_sale_price_psf, 0.25), median(redfin_median_sale_price_psf),
                  quantile_cont(redfin_median_sale_price_psf, 0.75), COUNT(*), MAX(month)
           FROM market_monthly WHERE geo_level = 'zip' AND geo_id = ?
             AND redfin_median_sale_price_psf IS NOT NULL
             AND month >= (SELECT MAX(month) FROM market_monthly WHERE geo_level='zip' AND geo_id = ?
                           AND redfin_median_sale_price_psf IS NOT NULL) - INTERVAL 12 MONTH""",
        [zip_code, zip_code],
    ).fetchone()
    if not row or row[1] is None:
        return None
    p25, p50, p75, n, as_of = row
    return {
        "method": "ZIP median $/sqft (Redfin), 12-month range",
        "sqft_used": round(sqft),
        "ppsf_low": round(p25),
        "ppsf_mid": round(p50),
        "ppsf_high": round(p75),
        "est_low": round(p25 * sqft),
        "est_mid": round(p50 * sqft),
        "est_high": round(p75 * sqft),
        "months_used": n,
        "as_of": as_of.isoformat() if hasattr(as_of, "isoformat") else str(as_of),
    }


def suggest(con, q: str, limit: int = 8) -> list[dict]:
    """Address suggestions, each carrying the search key (address) and a display string (full)."""
    needle = normalize_address(q)
    if len(needle) < 3:
        return []
    starts = _rows(
        con,
        "SELECT site_address_norm, city, zip_code FROM parcel_market "
        "WHERE site_address_norm LIKE ? ORDER BY 1 LIMIT ?",
        [f"{needle}%", limit],
    )
    contains = (
        []
        if len(starts) >= limit
        else _rows(
            con,
            "SELECT site_address_norm, city, zip_code FROM parcel_market "
            "WHERE site_address_norm LIKE ? AND site_address_norm NOT LIKE ? ORDER BY 1 LIMIT ?",
            [f"%{needle}%", f"{needle}%", limit - len(starts)],
        )
    )
    return [{"address": r["site_address_norm"], "full": full_address(r)} for r in starts + contains]


def meta(con) -> dict:
    """Freshness per source plus the geography list; drives the snapshot badge and status panel."""

    def one(sql):
        try:
            v = con.execute(sql).fetchone()
            return v[0] if v else None
        except Exception:  # noqa: BLE001 - a missing table just means "not loaded yet"
            return None

    def iso(v):
        return v.isoformat() if hasattr(v, "isoformat") else v

    sources = {
        "redfin": {
            "rows": one("SELECT COUNT(*) FROM redfin_market"),
            "latest_period": iso(one("SELECT MAX(period_begin) FROM redfin_market")),
            "source_updated": iso(one("SELECT MAX(source_last_updated) FROM redfin_market")),
        },
        "zillow": {
            "rows": one("SELECT COUNT(*) FROM zillow_index"),
            "latest_month": iso(one("SELECT MAX(month) FROM zillow_index")),
        },
        "fred": {
            "rows": one("SELECT COUNT(*) FROM fred_series"),
            "latest_date": iso(one("SELECT MAX(date) FROM fred_series")),
            "fetched_at": iso(one("SELECT MAX(fetched_at) FROM fred_series")),
        },
        "assessor": {
            "parcels": one("SELECT COUNT(*) FROM assessor_parcels"),
            "geocoded": one("SELECT COUNT(*) FROM assessor_parcels WHERE zip_code IS NOT NULL"),
            "fetched_at": iso(one("SELECT MAX(fetched_at) FROM assessor_parcels")),
            "by_parish": {
                r[0]: r[1]
                for r in (
                    con.execute("SELECT parish, COUNT(*) FROM assessor_parcels GROUP BY 1").fetchall()
                    if _table_exists(con, "assessor_parcels")
                    else []
                )
            },
        },
    }
    return {
        "generated": date.today().isoformat(),
        "sources": sources,
        "geos": geos(),
        "property_count": sources["assessor"]["parcels"] or 0,
        "refresh_windows": {p: m["refresh_window"] for p, m in config.PARISHES.items()},
    }
