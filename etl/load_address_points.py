"""Address points: every address the City knows, tied to its lot, for addresses the tax roll files
under another one.

The roll lists one site address per record, so an address that only appears on a building's
other entrance, a renamed street or the far side of a big lot isn't in it: the City's tax roll
files the condos at 600 Port of New Orleans Place under 1 Poydras St. The City's "Tabular
Address Points" list (data.nola.gov, public domain, ~226k addresses, each with its lot's GEOPIN)
links those addresses to their lot, so the site can open the building or parcel that is on it.

address_points — parish, address (in the roll's style: see backend/queries.py usps_style), unit
    (from "Unit 8H", "Ste 159"), lot_id (GEOPIN, the lot every record on it carries), the address
    as the City wrote it, pulled_at.

A pull that fails or reads far fewer addresses than the last one keeps the previous rows.

    python -m etl.load_address_points
"""

import argparse
import logging
from datetime import datetime, timezone

import duckdb

from backend.queries import USPS_TYPES, split_unit, usps_style

from . import config
from .assessor.http import PoliteSession

log = logging.getLogger(__name__)

SOURCES = {
    "orleans": {"domain": "data.nola.gov", "dataset_id": "cym7-cw5z"},
}
PAGE_SIZE = 50_000
MIN_SHARE_OF_PREVIOUS = 0.5

TABLE_SQL = """
    CREATE TABLE IF NOT EXISTS address_points (
        parish VARCHAR, address VARCHAR, unit VARCHAR, lot_id VARCHAR, source_address VARCHAR,
        pulled_at TIMESTAMP
    )
"""


# Whatever follows the street type is a unit, labelled or not: "3 Poydras Street Pent 12A",
# "... Place Spc 1018", "3 Poydras Street GA" (a garage). Only a tail with no street type in it
# that has a digit or is a short code counts, so "100 N St Patrick St" and "100 Avenue A" stay
# streets.
_STREET_TYPE_WORDS = {*USPS_TYPES, *USPS_TYPES.values()}
_UNIT_LABEL = {"PENT", "PH", "SPC", "RM", "BLDG"}


def _unit_after_type(address: str) -> tuple[str, str] | None:
    words = address.split(" ")
    for i in range(len(words) - 2, 1, -1):  # the last type word with a name before it
        if words[i] in _STREET_TYPE_WORDS:
            tail = words[i + 1 :]
            if tail[0] in _UNIT_LABEL and len(tail) > 1:
                tail = tail[1:]
            unit = " ".join(tail)
            if any(w in _STREET_TYPE_WORDS for w in tail):
                return None
            if any(ch.isdigit() for ch in unit) or (len(tail) == 1 and len(unit) <= 3):
                return " ".join(words[: i + 1]), unit
            return None
    return None


def roll_address(text: str | None) -> tuple[str | None, str | None]:
    """("600 PORT OF NEW ORLEANS PL", None) from "600 Port of New Orleans Place"; the unit comes off
    before the street type is abbreviated, so "Saint Andrew Street Apt A" still ends in ST."""
    base, unit = split_unit(text)
    if base and not unit:
        base, unit = _unit_after_type(base) or (base, None)
    base = usps_style(base)
    if base and not unit:
        base, unit = split_unit(base)
    return base, unit


def fetch(session: PoliteSession, domain: str, dataset_id: str) -> list[dict]:
    rows, offset = [], 0
    while True:
        page = session.get_json(
            f"https://{domain}/resource/{dataset_id}.json",
            params={"$select": "address,geopin", "$limit": PAGE_SIZE, "$offset": offset, "$order": ":id"},
            cache_key=f"address_points/{dataset_id}_{offset}",
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
        offset += len(page)


def load(con: duckdb.DuckDBPyConnection, session: PoliteSession | None = None) -> dict:
    con.execute(TABLE_SQL)
    session = session or PoliteSession(raw_dir=config.RAW_DIR, timeout=120)
    counts = {}
    for parish, src in SOURCES.items():
        rows = fetch(session, src["domain"], src["dataset_id"])
        pulled_at = datetime.now(timezone.utc).replace(tzinfo=None)
        out = set()
        for r in rows:
            lot = (r.get("geopin") or "").strip()
            address, unit = roll_address(r.get("address"))
            if lot and address:
                out.add((parish, address, unit, lot, r["address"].strip(), pulled_at))
        before = con.execute("SELECT COUNT(*) FROM address_points WHERE parish = ?", [parish]).fetchone()[0]
        if len(out) < before * MIN_SHARE_OF_PREVIOUS:
            raise RuntimeError(
                f"[{parish}] read {len(out):,} address points, under half the {before:,} stored"
            )
        con.execute("BEGIN")
        con.execute("DELETE FROM address_points WHERE parish = ?", [parish])
        con.executemany("INSERT INTO address_points VALUES (?, ?, ?, ?, ?, ?)", sorted(out, key=str))
        con.execute("COMMIT")
        counts[parish] = len(out)
        print(f"  [{parish}] {len(out):,} address points on {len({o[3] for o in out}):,} lots")
    return counts


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--db", default=str(config.DB_PATH))
    args = ap.parse_args(argv)
    con = duckdb.connect(args.db)
    print("Loading the City's address points...")
    load(con)
    print("Done.")


if __name__ == "__main__":
    main()
