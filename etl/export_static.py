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


def pid_key(parcel_id: str) -> str:
    """Parcel-number index file: the first 7 characters (Jefferson IDs are 10 digits and heavily
    shared at shorter prefixes). Must match frontend/src/api.js pidKey()."""
    return queries.slugify(parcel_id[:7]) or "_"


def near_key(lat: float, lng: float) -> str:
    return f"{math.floor(lat / NEAR_CELL_DEG)}_{math.floor(lng / NEAR_CELL_DEG)}"


def export_properties(con) -> int:
    prop_dir = OUT_DIR / "property"
    addr_dir = OUT_DIR / "addr"
    near_dir = OUT_DIR / "near"
    street_dir = OUT_DIR / "street"
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
    print("Comparing every assessment with similar parcels nearby and in its subdivision...")
    comparisons = queries.assessment_comparisons(con)
    print("Placing high-risk-zone parcels in FloodLens's validated census tracts...")
    floodlens = queries.floodlens_flags(con)

    print(f"Writing property files for {len(parcels)} parcels...")
    # Condos and apartments become buildings: an address with any numbered unit, or several records
    # on one lot at one address (how Orleans lists condo units: same lot and address, one tax bill
    # each, no unit number). Its address page lists the units; every unit (and any lot or
    # common-area parcel there) gets its own page by parcel number. Keyed by parish, so the same
    # address text in Jefferson and Orleans never merges.
    on_lot: dict[tuple, int] = {}
    for parcel in parcels:
        parcel["_building"], parcel["_unit"] = queries.split_unit(
            parcel.get("site_address_norm"), parcel.get("legal_description")
        )
        if parcel["_building"] and parcel.get("lat") is not None:
            spot = (parcel["parish"], parcel["_building"], round(parcel["lat"], 6), round(parcel["lng"], 6))
            on_lot[spot] = on_lot.get(spot, 0) + 1
    unit_buildings = {(p["parish"], p["_building"]) for p in parcels if p["_unit"] and p["_building"]}
    unit_buildings |= {(parish, addr) for (parish, addr, _, _), n in on_lot.items() if n > 1}
    buildings: dict[tuple, dict] = {}
    written: set[str] = set()
    shards: dict[str, list] = {}
    near: dict[str, list] = {}
    streets: dict[str, list] = {}
    pids: dict[str, list] = {}
    for parcel in parcels:
        building_addr, unit = parcel.pop("_building"), parcel.pop("_unit")
        key = (parcel["parish"], building_addr)
        in_building = key in unit_buildings
        addr = building_addr if in_building else (parcel.get("site_address_norm") or "").strip()
        slug = queries.slugify(addr) if addr else ""
        # The first parcel at an address owns its address page and its spot on the map. The rest
        # (the same address in the other parish, a lot sharing a number), building units, and
        # parcels with no street address get a page by parcel number.
        owns_address = bool(slug) and slug not in written and not in_building
        if not owns_address:
            slug = f"parcel-{queries.slugify(parcel['parcel_id'])}"
        written.add(slug)
        if REDACT_OWNER_NAMES:
            parcel.pop("owner_name", None)
        if in_building:
            building_full = queries.full_address({**parcel, "site_address": addr, "site_address_norm": addr})
            parcel["full_address"] = queries.unit_address(building_full, unit) if unit else building_full
            parcel["unit"] = unit
            b = buildings.setdefault(
                key, {"address": addr, "full": building_full, "parcel": parcel, "units": []}
            )
            b["units"].append(
                {
                    "unit": unit,
                    "parcel_id": parcel["parcel_id"],
                    "full": parcel["full_address"],
                    "assessed_val": parcel.get("assessed_val"),
                    # Units the roll doesn't number are told apart by tax bill and owner.
                    "tax_bill": parcel.get("tax_bill_number"),
                    "owner": parcel.get("owner_name"),
                }
            )
        else:
            parcel["full_address"] = queries.full_address_or_none(parcel)
        parcel.pop("assessed_value_history", None)
        data = {
            "parcel": parcel,
            "value_history": history_by_parcel.get((parcel["parish"], parcel["parcel_id"]), []),
            "valuation": _implied_valuation(parcel, zip_stats),
            "comparison": comparisons.get(parcel["parcel_id"]),
            "floodlens": floodlens.get(parcel["parcel_id"]),
        }
        if addr and not owns_address:
            # Its address opens another page (a building, or another parcel), so links and reloads
            # go by parcel number.
            data["lookup"] = f"Parcel {parcel['parcel_id']}"
        if in_building:
            data["building"] = {"address": addr, "full": buildings[key]["full"]}
        write_json(prop_dir / f"{slug}.json", data, compact=True)
        label = parcel["full_address"] or queries.parcel_label(parcel)
        pids.setdefault(pid_key(parcel["parcel_id"]), []).append([parcel["parcel_id"], slug, label])
        # Tax bill numbers find the parcel too (Orleans bills are numbered separately from parcels).
        bill = (parcel.get("tax_bill_number") or "").strip()
        if bill and bill != parcel["parcel_id"]:
            pids.setdefault(pid_key(bill), []).append([bill, slug, label, "bill"])
        if not addr:
            continue
        # Every parcel with an address is in the address index. A second parcel at an address, or a
        # unit, carries its parcel ID (and unit), so picking it opens that parcel.
        entry = {"address": addr, "full": parcel["full_address"], "slug": slug}
        if not owns_address:
            entry["parcel"] = parcel["parcel_id"]
        if unit:
            entry["unit"] = unit
        shards.setdefault(shard_key(addr), []).append(entry)
        if in_building:
            continue  # the building's street-list row and map dot are added once, below
        parts = queries.split_house_number(addr)
        if parts:
            row = [parts[0], addr, parcel["full_address"]]
            streets.setdefault(parts[1], []).append(row if owns_address else [*row, parcel["parcel_id"]])
        if owns_address and parcel.get("lat") is not None and parcel.get("lng") is not None:
            near.setdefault(near_key(parcel["lat"], parcel["lng"]), []).append(queries.nearby_entry(parcel))

    # Building pages: the address opens a list of its units.
    for (parish, addr), b in buildings.items():
        slug = queries.slugify(addr)
        if slug in written:  # the same address text is a house in the other parish
            slug = f"{slug}-{parish}"
        written.add(slug)
        b["slug"] = slug
        first = b.pop("parcel")
        units = sorted(
            b["units"], key=lambda u: (_natural(u["unit"] or ""), u["tax_bill"] or "", u["parcel_id"])
        )
        write_json(
            prop_dir / f"{slug}.json",
            {
                "building": {
                    **b,
                    "units": units,
                    "parish": first["parish"],
                    "lat": first.get("lat"),
                    "lng": first.get("lng"),
                }
            },
            compact=True,
        )
        # Numbered units if the roll numbers them (a lot or common-area record isn't a unit);
        # otherwise every record on the lot is one.
        n_units = sum(1 for u in units if u["unit"]) or len(units)
        shards.setdefault(shard_key(addr), []).append(
            {"address": addr, "full": b["full"], "slug": slug, "units": n_units}
        )
        parts = queries.split_house_number(addr)
        if parts:
            streets.setdefault(parts[1], []).append([parts[0], addr, b["full"]])
        if first.get("lat") is not None and first.get("lng") is not None:
            spot = {
                **first,
                "site_address": addr,
                "site_address_norm": addr,
                "assessed_val": None,
                "last_sale_price": None,
            }
            near.setdefault(near_key(first["lat"], first["lng"]), []).append(queries.nearby_entry(spot))
    in_buildings = sum(len(b["units"]) for b in buildings.values())
    print(f"  {len(buildings):,} buildings with units ({in_buildings:,} parcels)")

    parcel_pages = len(written) - len(buildings)  # building pages list units; they aren't parcels
    _write_dir(prop_dir, {}, keep=written)
    _write_dir(addr_dir, shards)
    _write_dir(near_dir, near)
    _write_dir(OUT_DIR / "pid", {k: sorted(v) for k, v in pids.items()})
    # Per-street house numbers (closest-number offers on a miss, and the street list), plus the
    # street-name index that street search matches against.
    _write_dir(street_dir, {queries.slugify(k): sorted(v) for k, v in streets.items()})
    write_json(OUT_DIR / "streets.json", queries.street_index(streets), compact=True)
    return parcel_pages


def _natural(label: str) -> list:
    """Sort key for unit labels: 2 < 10 < 10A < B."""
    return [(0, int(t), "") if t.isdigit() else (1, 0, t) for t in re.findall(r"\d+|\D+", label)]


def _write_dir(directory: Path, files: dict[str, list], keep: set[str] | None = None) -> None:
    """Write {stem: rows} as stem.json and delete any file left over from an earlier export."""
    directory.mkdir(parents=True, exist_ok=True)
    keep = set(files) if keep is None else keep
    for stale in directory.glob("*.json"):
        if stale.stem not in keep:
            stale.unlink()
    for stem, rows in files.items():
        write_json(directory / f"{stem}.json", rows, compact=True)


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
