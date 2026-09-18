"""Export API responses as static JSON for GitHub Pages hosting (mirrors the Houston export).

Writes to frontend/public/data/:
    meta.json                    freshness per source, geography list, refresh windows
    macro.json                   latest FRED values (macro strip)
    macro_index.json             FRED history (Macro view)
    scorecard.json               one row per geography: latest metrics, YoY, sparklines
    compare.json                 every geography's monthly series (compare charts)
    trend_<level>_<id>.json      one geography's monthly series
    addresses.json + property/   one JSON per parcel (empty until the assessor leg has run)

    python -m etl.export_static
"""

import json
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
    path.write_text(json.dumps(data, separators=(",", ":")) if compact else json.dumps(data, indent=1))


def export_market(con):
    print("Exporting market trends...")
    for g in queries.geos():
        name = f"trend_{g['geo_level']}_{g['geo_id']}.json"
        write_json(OUT_DIR / name, queries.trend(con, g["geo_level"], g["geo_id"]))
    write_json(OUT_DIR / "compare.json", queries.compare(con), compact=True)
    write_json(OUT_DIR / "scorecard.json", queries.scorecard(con))
    write_json(OUT_DIR / "macro.json", queries.macro_snapshot(con))
    write_json(OUT_DIR / "macro_index.json", {"series": queries.macro_index(con)}, compact=True)


def export_properties(con) -> int:
    prop_dir = OUT_DIR / "property"
    prop_dir.mkdir(parents=True, exist_ok=True)
    if not queries._table_exists(con, "parcel_market"):
        write_json(OUT_DIR / "addresses.json", [], compact=True)
        return 0
    addresses = [
        r[0]
        for r in con.execute(
            "SELECT DISTINCT site_address_norm FROM parcel_market "
            "WHERE site_address_norm IS NOT NULL ORDER BY 1"
        ).fetchall()
    ]
    print(f"Writing {len(addresses)} property files...")
    seen = set()
    exported = []
    for addr in addresses:
        slug = queries.slugify(addr)
        if not slug or slug in seen:
            continue
        seen.add(slug)
        data = queries.property_lookup(con, addr)
        if not data:
            continue
        if REDACT_OWNER_NAMES:
            data["parcel"].pop("owner_name", None)
        write_json(prop_dir / f"{slug}.json", data, compact=True)
        exported.append(addr)
    for stale in prop_dir.glob("*.json"):
        if stale.stem not in seen:
            stale.unlink()
    write_json(OUT_DIR / "addresses.json", exported, compact=True)
    return len(exported)


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
