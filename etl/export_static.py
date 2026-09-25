"""Export API responses as static JSON for GitHub Pages hosting (mirrors the Houston export).

Writes to frontend/public/data/:
    meta.json                    freshness per source, geography list, refresh windows
    macro.json                   latest FRED values (macro strip)
    macro_index.json             FRED history (Macro view)
    costs.json                   per-ZIP property tax rate + flood insurance cost (monthly cost)
    scorecard.json               one row per geography: latest metrics, YoY, sparklines
    compare.json                 every geography's monthly series (compare charts)
    trend_<level>_<id>.json      one geography's monthly series
    addr/<key>.json + property/  one JSON per parcel (empty until the assessor leg has run) —
                                  addr/ is sharded by the first 3 chars of the address (see
                                  shard_key below) so the client fetches a few KB per keystroke
                                  instead of the entire address list

    python -m etl.export_static
"""

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from backend import queries  # noqa: E402
from backend.db import get_connection  # noqa: E402

OUT_DIR = ROOT / "frontend" / "public" / "data"
REDACT_OWNER_NAMES = False  # assessor records are public; mirror the Houston default


def write_json(path: Path, data, compact=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    # CodeQL flags this as clear-text storage of sensitive data because parcel records carry
    # owner_name. Louisiana parcel assessments — owner, address, assessed value — are public
    # record; the assessors' own sites (jpassessor.net, nolaassessor.com) publish the same
    # data unencrypted. REDACT_OWNER_NAMES above is the actual opt-out if that changes.
    path.write_text(  # lgtm[py/clear-text-storage-sensitive-data]
        json.dumps(data, separators=(",", ":")) if compact else json.dumps(data, indent=1)
    )


def export_market(con):
    print("Exporting market trends...")
    for g in queries.geos():
        name = f"trend_{g['geo_level']}_{g['geo_id']}.json"
        write_json(OUT_DIR / name, queries.trend(con, g["geo_level"], g["geo_id"]))
    write_json(OUT_DIR / "compare.json", queries.compare(con), compact=True)
    write_json(OUT_DIR / "scorecard.json", queries.scorecard(con))
    write_json(OUT_DIR / "macro.json", queries.macro_snapshot(con))
    write_json(OUT_DIR / "macro_index.json", {"series": queries.macro_index(con)}, compact=True)
    write_json(OUT_DIR / "costs.json", queries.ownership_costs(con), compact=True)


_ZIP_VALUATION_SQL = """
    WITH per_zip_max AS (
        SELECT geo_id, MAX(month) AS max_month
        FROM market_monthly
        WHERE geo_level = 'zip' AND redfin_median_sale_price_psf IS NOT NULL
        GROUP BY geo_id
    )
    SELECT m.geo_id,
           quantile_cont(m.redfin_median_sale_price_psf, 0.25) AS ppsf_low,
           median(m.redfin_median_sale_price_psf) AS ppsf_mid,
           quantile_cont(m.redfin_median_sale_price_psf, 0.75) AS ppsf_high,
           COUNT(*) AS months_used,
           MAX(m.month) AS as_of
    FROM market_monthly m
    JOIN per_zip_max z ON z.geo_id = m.geo_id
    WHERE m.geo_level = 'zip' AND m.redfin_median_sale_price_psf IS NOT NULL
      AND m.month >= z.max_month - INTERVAL 12 MONTH
    GROUP BY m.geo_id
"""


def _implied_valuation(parcel: dict, zip_stats: dict) -> dict | None:
    """Same formula as queries.implied_valuation, against precomputed per-ZIP stats instead of
    a fresh query — the per-parcel query is fine for a single live lookup, not for 145k of them."""
    sqft = parcel.get("building_area")
    zip_code = parcel.get("zip_code")
    if not sqft or not zip_code:
        return None
    stats = zip_stats.get(zip_code)
    if not stats or stats.get("ppsf_mid") is None:
        return None
    p25, p50, p75 = stats["ppsf_low"], stats["ppsf_mid"], stats["ppsf_high"]
    return {
        "method": "ZIP median $/sqft (Redfin), 12-month range",
        "sqft_used": round(sqft),
        "ppsf_low": round(p25),
        "ppsf_mid": round(p50),
        "ppsf_high": round(p75),
        "est_low": round(p25 * sqft),
        "est_mid": round(p50 * sqft),
        "est_high": round(p75 * sqft),
        "months_used": stats["months_used"],
        "as_of": stats["as_of"],
    }


def shard_key(addr: str) -> str:
    """Must match frontend/src/api.js's shardKey() exactly — same input, same output, or the
    client fetches a shard file that was never written."""
    return re.sub(r"[^A-Z0-9]", "_", addr[:3].upper())


# Nearby-homes grid: parcels bucketed into NEAR_CELL_DEG squares (~550 m × 480 m here) so the
# property map loads only the few cells around one address. Must match frontend/src/lib/nearby.js.
NEAR_CELL_DEG = 0.005


def near_key(lat: float, lng: float) -> str:
    return f"{math.floor(lat / NEAR_CELL_DEG)}_{math.floor(lng / NEAR_CELL_DEG)}"


def export_properties(con) -> int:
    prop_dir = OUT_DIR / "property"
    addr_dir = OUT_DIR / "addr"
    near_dir = OUT_DIR / "near"
    near_dir.mkdir(parents=True, exist_ok=True)
    prop_dir.mkdir(parents=True, exist_ok=True)
    addr_dir.mkdir(parents=True, exist_ok=True)
    if not queries._table_exists(con, "parcel_market"):
        return 0

    print("Fetching parcels, value history and per-ZIP valuation stats (batched, not per-parcel)...")
    parcels = queries._rows(con, "SELECT * FROM parcel_market ORDER BY site_address_norm")
    history_rows = queries._rows(
        con,
        """SELECT parish, parcel_id, tax_year, land_val, bld_val, tot_mkt_val, assessed_val,
                  homestead_exempt_val, taxable_val
           FROM assessed_value_history ORDER BY parish, parcel_id, tax_year""",
    )
    history_by_parcel: dict[tuple, list] = {}
    for h in history_rows:
        key = (h["parish"], h["parcel_id"])
        history_by_parcel.setdefault(key, []).append(
            {k: v for k, v in h.items() if k not in ("parish", "parcel_id")}
        )
    zip_stats = {r["geo_id"]: r for r in queries._rows(con, _ZIP_VALUATION_SQL)}

    print(f"Writing property files for {len(parcels)} parcels...")
    seen_slugs = set()
    shards: dict[str, list] = {}
    near: dict[str, list] = {}
    for parcel in parcels:
        addr = parcel.get("site_address_norm")
        slug = addr and queries.slugify(addr)
        if not slug or slug in seen_slugs:
            continue
        seen_slugs.add(slug)
        if REDACT_OWNER_NAMES:
            parcel.pop("owner_name", None)
        parcel["full_address"] = queries.full_address(parcel)
        parcel.pop("assessed_value_history", None)
        data = {
            "parcel": parcel,
            "value_history": history_by_parcel.get((parcel["parish"], parcel["parcel_id"]), []),
            "valuation": _implied_valuation(parcel, zip_stats),
        }
        write_json(prop_dir / f"{slug}.json", data, compact=True)
        shards.setdefault(shard_key(addr), []).append(
            {"address": addr, "full": parcel["full_address"], "slug": slug}
        )
        if parcel.get("lat") is not None and parcel.get("lng") is not None:
            near.setdefault(near_key(parcel["lat"], parcel["lng"]), []).append(queries.nearby_entry(parcel))
    for stale in prop_dir.glob("*.json"):
        if stale.stem not in seen_slugs:
            stale.unlink()
    for stale in addr_dir.glob("*.json"):
        if stale.stem not in shards:
            stale.unlink()
    for key, entries in shards.items():
        write_json(addr_dir / f"{key}.json", entries, compact=True)
    for stale in near_dir.glob("*.json"):
        if stale.stem not in near:
            stale.unlink()
    for key, entries in near.items():
        write_json(near_dir / f"{key}.json", entries, compact=True)
    return len(seen_slugs)


def main():
    con = get_connection()
    export_market(con)
    count = export_properties(con)
    meta = queries.meta(con)
    meta["generated"] = datetime.now(timezone.utc).isoformat()
    meta["property_count"] = count
    meta["owner_names_redacted"] = REDACT_OWNER_NAMES
    write_json(OUT_DIR / "meta.json", meta)
    print(f"Done. {count} properties, {len(queries.geos())} geographies.")


if __name__ == "__main__":
    main()
