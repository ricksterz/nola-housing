"""Inputs for the true monthly cost of owning: property tax rate and flood insurance cost by ZIP.

zip_tax_rate — Census ACS 5-year, owner-occupied homes: aggregate real estate taxes paid
    (B25090) ÷ aggregate home value (B25082) = the effective tax rate owners actually pay, which
    already reflects the homestead exemption most owner-occupants get. full_rate backs that
    exemption out — taxes ÷ (value − HOMESTEAD_EXEMPT_VALUE × owner-occupied units, B25003) — so a
    home can be taxed as a residence (price minus the exemption) or as a rental or second home
    (the full price). Median taxes paid (B25103) is kept for context. Downloaded only when a newer
    vintage than the stored one is published.

zip_flood_cost — FEMA OpenFEMA NFIP policies in force: for single-family, one-year policies that
    took effect in the last NFIP_LOOKBACK_DAYS, the 25th/50th/75th percentile of policyCost (what
    the policyholder pays: premium plus fees and surcharges), split into special flood hazard
    area (rated zone A*/V*) vs. everything else, plus all combined.

Homeowners (wind/fire) insurance has no public ZIP-level source, so it's a user input, not data.

Each source updates independently; if one fails, its previous rows are kept and the refresh goes
on, and the pulled_at dates shown in the app say how current each is.

    python -m etl.load_costs
"""

import csv
import io
import logging
import statistics
from datetime import date, datetime, timedelta, timezone

import duckdb
import requests

from . import config
from .assessor.http import PoliteSession

log = logging.getLogger(__name__)

TAX_SQL = """
    CREATE TABLE IF NOT EXISTS zip_tax_rate (
        zip VARCHAR, acs_year INTEGER, aggregate_taxes DOUBLE, aggregate_value DOUBLE,
        effective_rate DOUBLE, median_tax_paid DOUBLE, pulled_at TIMESTAMP,
        owner_units DOUBLE, full_rate DOUBLE
    )
"""
TAX_COLUMNS = (
    "zip, acs_year, aggregate_taxes, aggregate_value, effective_rate, median_tax_paid, pulled_at, "
    "owner_units, full_rate"
)
FLOOD_SQL = """
    CREATE TABLE IF NOT EXISTS zip_flood_cost (
        zip VARCHAR, zone_group VARCHAR, policies INTEGER, p25 DOUBLE, median DOUBLE, p75 DOUBLE,
        period_start DATE, period_end DATE, pulled_at TIMESTAMP
    )
"""

# NFIP occupancy codes: 1 = single family (legacy rating), 11 = single family (Risk Rating 2.0).
SINGLE_FAMILY = {1, 11}


def ensure_tables(con: duckdb.DuckDBPyConnection) -> None:
    con.execute(TAX_SQL)
    # Tables created before full_rate existed.
    con.execute("ALTER TABLE zip_tax_rate ADD COLUMN IF NOT EXISTS owner_units DOUBLE")
    con.execute("ALTER TABLE zip_tax_rate ADD COLUMN IF NOT EXISTS full_rate DOUBLE")
    con.execute(FLOOD_SQL)


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---------------------------------------------------------------------------
# Property tax (ACS)
# ---------------------------------------------------------------------------
def _acs_table(session: PoliteSession, year: int, table: str, column: str) -> dict[str, float] | None:
    """{zip: value} for our ZIPs from one ACS table file; None if that vintage isn't published."""
    resp = session.get(config.ACS_TABLE_URL.format(year=year, table=table))
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    want = {f"860Z200US{z}": z for z in config.ZIPS}
    out = {}
    for row in csv.DictReader(io.StringIO(resp.text), delimiter="|"):
        z = want.get(row.get("GEO_ID"))
        if z is None:
            continue
        try:
            out[z] = float(row[column])
        except (TypeError, ValueError):
            pass  # ACS suppresses some estimates with non-numeric markers
    return out


def _full_rate(taxes: float, value: float, owner_units: float | None) -> float | None:
    """Tax rate on value with no homestead exemption, from the owner-occupied aggregates."""
    if not owner_units:
        return None
    taxable = value - config.HOMESTEAD_EXEMPT_VALUE * owner_units
    return taxes / taxable if taxable > 0 else None


def load_tax(con: duckdb.DuckDBPyConnection, session: PoliteSession, today: date | None = None) -> int | None:
    """Refresh zip_tax_rate if a newer ACS 5-year vintage exists. Returns the vintage loaded, or None."""
    today = today or date.today()
    # Rows without full_rate predate it and count as missing, so they're reloaded once.
    have = (
        con.execute("SELECT MAX(acs_year) FROM zip_tax_rate WHERE full_rate IS NOT NULL").fetchone()[0] or 0
    )
    for year in range(today.year - 1, max(have, today.year - 4), -1):
        taxes = _acs_table(session, year, "b25090", "B25090_E001")
        if taxes is None:
            continue
        values = _acs_table(session, year, "b25082", "B25082_E001") or {}
        medians = _acs_table(session, year, "b25103", "B25103_E001") or {}
        owners = _acs_table(session, year, "b25003", "B25003_E002") or {}
        rows = [
            (
                z,
                year,
                taxes[z],
                values[z],
                taxes[z] / values[z],
                medians.get(z),
                _now(),
                owners.get(z),
                _full_rate(taxes[z], values[z], owners.get(z)),
            )
            for z in config.ZIPS
            if z in taxes and values.get(z)
        ]
        if not rows:
            raise RuntimeError(f"ACS {year} had no usable rows for our ZIPs")
        con.execute("BEGIN")
        con.execute("DELETE FROM zip_tax_rate")
        con.executemany(f"INSERT INTO zip_tax_rate ({TAX_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
        con.execute("COMMIT")
        print(f"  zip_tax_rate: ACS {year}, {len(rows)} ZIPs")
        return year
    print(f"  zip_tax_rate: no ACS vintage newer than {have or 'none'}; kept existing rows")
    return None


# ---------------------------------------------------------------------------
# Flood insurance (OpenFEMA NFIP policies)
# ---------------------------------------------------------------------------
def _policies(session: PoliteSession, zip_code: str, since: date) -> list[dict]:
    rows, skip = [], 0
    while True:
        resp = session.get(
            config.NFIP_POLICIES_URL,
            params={
                "$filter": (
                    f"reportedZipCode eq '{zip_code}' and "
                    f"policyEffectiveDate ge '{since.isoformat()}T00:00:00.000Z'"
                ),
                "$select": "policyCost,ratedFloodZone,occupancyType,policyTermIndicator,policyCount",
                "$top": "10000",
                "$skip": str(skip),
            },
        )
        resp.raise_for_status()
        page = resp.json().get("FimaNfipPolicies", [])
        rows += page
        if len(page) < 10000:
            return rows
        skip += len(page)


def _quartiles(values: list[float]) -> tuple[float, float, float]:
    if len(values) == 1:
        return values[0], values[0], values[0]
    p25, p50, p75 = statistics.quantiles(values, n=4, method="inclusive")
    return p25, p50, p75


def flood_cost_rows(zip_code: str, policies: list[dict], since: date, until: date, pulled_at) -> list[tuple]:
    costs = {"sfha": [], "other": []}
    for p in policies:
        if p.get("occupancyType") not in SINGLE_FAMILY:
            continue
        if str(p.get("policyTermIndicator")) != "1" or p.get("policyCount") != 1:
            continue
        cost = p.get("policyCost")
        if not cost or cost <= 0:
            continue
        zone = (p.get("ratedFloodZone") or "").upper()
        costs["sfha" if zone[:1] in ("A", "V") else "other"].append(float(cost))
    costs["all"] = costs["sfha"] + costs["other"]
    out = []
    for group, values in costs.items():
        if len(values) < config.NFIP_MIN_POLICIES:
            continue
        p25, p50, p75 = _quartiles(sorted(values))
        out.append((zip_code, group, len(values), p25, p50, p75, since, until, pulled_at))
    return out


def load_flood_costs(
    con: duckdb.DuckDBPyConnection, session: PoliteSession, today: date | None = None
) -> int:
    """Replace zip_flood_cost with the last year of policies for every ZIP; all-or-nothing."""
    today = today or date.today()
    since = today - timedelta(days=config.NFIP_LOOKBACK_DAYS)
    pulled_at = _now()
    rows = []
    for z in config.ZIPS:
        rows += flood_cost_rows(z, _policies(session, z, since), since, today, pulled_at)
    if not rows:
        raise RuntimeError("NFIP returned no usable policies for any ZIP")
    con.execute("BEGIN")
    con.execute("DELETE FROM zip_flood_cost")
    con.executemany("INSERT INTO zip_flood_cost VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    con.execute("COMMIT")
    zips = len({r[0] for r in rows})
    print(f"  zip_flood_cost: {zips} ZIPs, policies effective {since} – {today}")
    return zips


def load(con: duckdb.DuckDBPyConnection, session: PoliteSession | None = None) -> None:
    ensure_tables(con)
    session = session or PoliteSession(min_interval=1.0, max_retries=5)
    for name, fn in (("property tax (ACS)", load_tax), ("flood insurance (NFIP)", load_flood_costs)):
        try:
            fn(con, session)
        except (requests.RequestException, RuntimeError, ValueError) as e:
            try:
                con.execute("ROLLBACK")
            except duckdb.Error:
                pass  # failed before the write transaction started
            log.warning("ownership costs: %s refresh failed (%s); kept existing rows", name, e)
            print(f"  ownership costs: {name} failed ({e}); kept existing rows")


def main():
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    con = duckdb.connect(str(config.DB_PATH))
    load(con)
    con.close()


if __name__ == "__main__":
    main()
