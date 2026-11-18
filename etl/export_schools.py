"""Nearby schools for the property report: a compact copy of NOLA Atlas School Finder's school list.

School Finder (https://schools.nolaatlas.com/) is a separate site by the same builder. Its page
carries its whole school list as embedded JSON (<script type="application/json" id="data">). The
property report needs only who is nearby and what kind of school each is, so this keeps a few
fields per school and writes frontend/public/data/schools.json. Chances of getting in, seats and
dates stay on School Finder, which the report links to; nothing here re-derives them.

A failed fetch never fails the deploy: it prints a warning and writes no file, and the report
then shows the plain "Schools near <ZIP>" link it had before.

    python -m etl.export_schools                          # fetch School Finder
    SCHOOLS_SOURCE=path/to/page.html python -m etl.export_schools   # offline, from a saved page
"""

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "data" / "schools.json"
SCHOOLS_URL = "https://schools.nolaatlas.com/"
USER_AGENT = "NOLA Atlas build (nolaatlas.com; reads its sister site School Finder)"

_DATA_RE = re.compile(r'<script[^>]*\bid="data"[^>]*>(.*?)</script>', re.S)


def slug(name: str) -> str:
    """School Finder's share-link slug for a school (its ?school= value). Must match its slug()."""
    s = name.lower().replace("&", " and ")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _tuition(t: dict | None) -> dict | None:
    """Published tuition range, or None. Only a found rate is a rate; anything else is unknown."""
    if not t or t.get("status") != "found":
        return None
    amounts = [r.get("amount") for r in t.get("rates") or [] if isinstance(r.get("amount"), (int, float))]
    if not amounts:
        return None
    return {"low": min(amounts), "high": max(amounts), "year": t.get("year") or None}


def compact(schools: list[dict]) -> list[dict]:
    """Keep what the report shows; drop schools with no location (they can't be 'nearby')."""
    out = []
    for s in schools:
        if s.get("lat") is None or s.get("lon") is None or not s.get("school"):
            continue
        public = s.get("sector") == "public"
        out.append(
            {
                "name": s["school"],
                "slug": slug(s["school"]),
                "parish": s.get("parish"),
                "lat": round(float(s["lat"]), 5),
                "lng": round(float(s["lon"]), 5),
                "grades": s.get("grades") or None,
                "kind": "public" if public else "catholic" if s.get("catholic") else "private",
                "charter": bool(s.get("charter")) if public else None,
                "admission": s.get("admission") or None,
                "letter_grade": (s.get("letter_grade") or None) if public else None,
                "tuition": None if public else _tuition(s.get("tuition")),
            }
        )
    return sorted(out, key=lambda r: r["name"])


def parse_page(html: str) -> list[dict]:
    m = _DATA_RE.search(html)
    if not m:
        raise ValueError("School Finder page has no embedded school list (script#data)")
    data = json.loads(m.group(1))
    if not isinstance(data, list) or not data:
        raise ValueError("School Finder's school list is empty")
    return data


def fetch_page() -> str:
    source = os.environ.get("SCHOOLS_SOURCE")
    if source:
        return Path(source).read_text()
    import requests

    r = requests.get(SCHOOLS_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    r.raise_for_status()
    return r.text


def main(out: Path = OUT) -> int:
    try:
        rows = compact(parse_page(fetch_page()))
    except Exception as e:  # noqa: BLE001 - a sister site being down must not stop the deploy
        print(f"Schools: skipped ({type(e).__name__}: {e}); the report keeps its School Finder link.")
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps({"source": SCHOOLS_URL, "schools": rows}, separators=(",", ":")))
    print(f"Schools: {len(rows)} with a location, from School Finder.")
    return len(rows)


if __name__ == "__main__":
    main()
    sys.exit(0)
