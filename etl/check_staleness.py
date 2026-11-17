"""Fail the build when a source's data in meta.json is older than its threshold.

Every loader fails soft by design (a dead upstream warns and keeps the previous
data), so a source can go quietly stale for months — Redfin sat at May 2026,
flood zones unmoved since September — with every workflow still green. This
script is the watcher: it reads the exported meta.json, checks each source's
freshness date against a threshold, and exits non-zero naming every stale
source. It never fetches anything; it only reads the file.

Wiring (one line, in the export workflow, after the meta.json export step):

    python -m etl.check_staleness

Thresholds are per-source because the cadences differ: the assessor's Orleans
pull runs twice a week (21 days matches refresh_assessor.STALE_AFTER_DAYS),
Zillow/FRED/flood are monthly (60–90 days), Redfin is a dead feed being kept
alive on last-good data (180 days), and the cost inputs move annually (400 days
/ 2 years).
"""

import json
import sys
from datetime import date, datetime
from pathlib import Path

# name -> (meta.json path, max age in days). Paths are dotted keys into the
# "sources" object; a trailing None means "within N years of today" instead.
CHECKS: tuple[tuple[str, str, int], ...] = (
    ("redfin", "redfin.latest_period", 180),
    ("zillow", "zillow.latest_month", 90),
    ("fred", "fred.fetched_at", 60),
    ("flood", "flood.pulled_at", 90),
    ("assessor-orleans", "assessor.fetched_by_parish.orleans", 21),
    ("assessor-jefferson", "assessor.fetched_by_parish.jefferson", 400),
    ("costs-flood", "costs.flood_pulled_at", 400),
)

# Year-valued checks: (name, meta.json path, max age in years).
YEAR_CHECKS: tuple[tuple[str, str, int], ...] = (("costs-tax", "costs.tax_acs_year", 2),)


def _lookup(meta: dict, path: str):
    node: dict | str | int | None = meta.get("sources", {})
    for part in path.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


def _parse_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, int):
        return date(value, 1, 1)
    text = str(value)
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        return None


def check(meta: dict, today: date | None = None) -> list[str]:
    """Return one human-readable problem per stale or missing source."""
    today = today or date.today()
    problems: list[str] = []
    for name, path, max_days in CHECKS:
        value = _parse_date(_lookup(meta, path))
        if value is None:
            problems.append(f"{name}: no date in meta.json ({path})")
            continue
        age = (today - value).days
        if age > max_days:
            extra = ""
            if name == "flood":
                status = _lookup(meta, "flood.status")
                detail = _lookup(meta, "flood.status_detail")
                if status and status != "ok":
                    extra = f" (status: {status}" + (f": {detail}" if detail else "") + ")"
            problems.append(f"{name}: {value.isoformat()} is {age} days old (threshold {max_days}){extra}")
    for name, path, max_years in YEAR_CHECKS:
        value = _lookup(meta, path)
        if not isinstance(value, int):
            problems.append(f"{name}: no year in meta.json ({path})")
            continue
        if today.year - value > max_years:
            problems.append(
                f"{name}: tax year {value} is {today.year - value} years old (threshold {max_years})"
            )
    return problems


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    path = (
        Path(argv[0])
        if argv
        else Path(__file__).resolve().parents[1] / "frontend" / "public" / "data" / "meta.json"
    )
    if not path.exists():
        print(f"check_staleness: {path} not found")
        return 1
    problems = check(json.loads(path.read_text()))
    if not problems:
        print("check_staleness: all sources fresh")
        return 0
    print("check_staleness: stale sources:")
    for problem in problems:
        print(f"  - {problem}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
