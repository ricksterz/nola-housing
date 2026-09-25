"""Assessor leg: land Jefferson + Orleans parcel records in ``assessor_parcels_raw`` and derive
``assessor_parcels`` (current record per parcel) and ``assessed_value_history`` (one row per
parcel per tax year, appended on every refresh so value history accumulates across rolls).

Per parish the loader:
  1. probes the configured official bulk options (ArcGIS parcel layer / Socrata dataset) and
     uses the first one whose fields map to the parcel schema;
  2. otherwise batch-pulls the public search UI under the polite rate limits in ``etl.config``,
     seeded from ASSESSOR_SEED_FILE and/or parcel IDs already in the database, with a
     checkpoint so a capped run resumes on the next invocation.

Raw payloads (attributes / label pairs / value tables) are kept as JSON alongside the parsed
columns so the parsed schema can be re-derived without another pull.
"""

import argparse
import json
import logging
from datetime import date, datetime, timezone

import duckdb

from . import config, geocode
from .assessor import ADAPTERS, bulk
from .assessor.base import PARCEL_FIELDS, ParcelRecord
from .assessor.http import PoliteSession
from .assessor.search_ui import Checkpoint, load_seed_ids, pull_parcels

log = logging.getLogger(__name__)

RAW_COLUMNS = PARCEL_FIELDS + ("source_kind", "source_url", "fetched_at", "payload")

_TYPES = {
    "land_area": "DOUBLE",
    "building_area": "DOUBLE",
    "year_built": "INTEGER",
    "land_val": "DOUBLE",
    "bld_val": "DOUBLE",
    "tot_mkt_val": "DOUBLE",
    "assessed_val": "DOUBLE",
    "homestead_exempt_val": "DOUBLE",
    "taxable_val": "DOUBLE",
    "tax_year": "INTEGER",
    "last_sale_date": "DATE",
    "last_sale_price": "DOUBLE",
    "lat": "DOUBLE",
    "lng": "DOUBLE",
    "fetched_at": "TIMESTAMP",
    "payload": "JSON",
    "last_sale_qualified": "BOOLEAN",
}


def ensure_tables(con: duckdb.DuckDBPyConnection) -> None:
    cols = ", ".join(f"{c} {_TYPES.get(c, 'VARCHAR')}" for c in RAW_COLUMNS)
    con.execute(f"CREATE TABLE IF NOT EXISTS assessor_parcels_raw ({cols})")
    # The committed database predates newer fields; add whatever columns it's missing.
    for c in RAW_COLUMNS:
        con.execute(
            f"ALTER TABLE assessor_parcels_raw ADD COLUMN IF NOT EXISTS {c} {_TYPES.get(c, 'VARCHAR')}"
        )
    con.execute(
        """
        CREATE TABLE IF NOT EXISTS assessor_bulk_probes (
            probed_at TIMESTAMP, parish VARCHAR, kind VARCHAR, url VARCHAR, ok BOOLEAN,
            reason VARCHAR, record_count BIGINT, field_map JSON
        )
        """
    )


def _insert(con, rec: ParcelRecord, source_kind: str, source_url: str, fetched_at: datetime) -> None:
    payload = json.dumps(rec.extra, default=str)
    row = rec.as_row() + (source_kind, source_url, fetched_at, payload)
    placeholders = ", ".join("?" for _ in RAW_COLUMNS)
    con.execute(
        f"INSERT INTO assessor_parcels_raw ({', '.join(RAW_COLUMNS)}) VALUES ({placeholders})", list(row)
    )


def _existing_ids(con, parish: str) -> list[str]:
    return [
        r[0]
        for r in con.execute(
            "SELECT DISTINCT parcel_id FROM assessor_parcels_raw WHERE parish = ? ORDER BY 1", [parish]
        ).fetchall()
    ]


# A bulk pull must read at least this share of the features the layer says it has before it
# replaces a parish's rows; anything less is a failed pull, not a smaller parish.
BULK_MIN_COMPLETE = 0.98


def _check_complete(parish: str, features: int, expected: int | None, max_records: int | None) -> None:
    if max_records or not expected:
        return
    if features < expected * BULK_MIN_COMPLETE:
        raise RuntimeError(
            f"[{parish}] bulk pull read {features:,} of {expected:,} features; keeping the previous load"
        )


def load_parish(
    con: duckdb.DuckDBPyConnection,
    parish: str,
    session: PoliteSession | None = None,
    tax_year: int | None = None,
    seed_file: str | None = None,
    force_search_ui: bool = False,
    max_records: int | None = None,
) -> dict:
    ensure_tables(con)
    src = config.ASSESSOR_SOURCES[parish]
    fips = config.PARISH_FIPS[parish]
    session = session or PoliteSession(raw_dir=config.RAW_DIR)
    if session.raw_dir is None:
        session.raw_dir = config.RAW_DIR
    session.timeout = max(session.timeout, src.get("timeout_seconds", 0))
    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)
    tax_year = tax_year or date.today().year
    summary = {"parish": parish, "source": None, "records": 0}

    # 1) Official bulk options first.
    if not force_search_ui:
        for probe in bulk.probe_candidates(src["bulk_candidates"], session):
            con.execute(
                "INSERT INTO assessor_bulk_probes VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    fetched_at,
                    parish,
                    probe.kind,
                    probe.url,
                    probe.ok,
                    probe.reason,
                    probe.record_count,
                    json.dumps(probe.field_map or {}),
                ],
            )
            print(f"  [{parish}] bulk probe {probe.kind} {probe.url}: {'OK' if probe.ok else probe.reason}")
            if not probe.ok:
                continue
            cand = next(c for c in src["bulk_candidates"] if c["kind"] == probe.kind)
            if probe.kind == "arcgis":
                pulled: dict = {}
                records = bulk.fetch_arcgis(
                    cand["url"], session, parish, fips, probe.field_map, max_records=max_records, stats=pulled
                )
                _check_complete(parish, pulled.get("features", len(records)), probe.record_count, max_records)
            else:
                records = bulk.fetch_socrata(
                    cand["domain"],
                    cand["dataset_id"],
                    session,
                    parish,
                    fips,
                    probe.field_map,
                    max_records=max_records,
                )
            con.execute("BEGIN")
            con.execute(
                "DELETE FROM assessor_parcels_raw WHERE parish = ? AND source_kind = ?",
                [parish, f"bulk:{probe.kind}"],
            )
            for rec in records:
                rec.tax_year = rec.tax_year or tax_year
                _insert(con, rec, f"bulk:{probe.kind}", probe.url, fetched_at)
            con.execute("COMMIT")
            summary.update(source=f"bulk:{probe.kind}", records=len(records))
            print(f"  [{parish}] loaded {len(records)} parcels from {probe.kind}")
            return summary

    # 2) Fallback: rate-limited batch pull of the public search UI, where the parish allows it.
    disabled = src.get("search_ui", {}).get("disabled")
    if disabled:
        print(f"  [{parish}] no bulk source answered, and the search UI fallback is off: {disabled}")
        summary.update(source=None, records=0, note="no bulk source; search UI disabled")
        return summary
    adapter = ADAPTERS[parish]()
    ids = load_seed_ids(parish, seed_file, existing=_existing_ids(con, parish))
    if max_records:
        ids = ids[:max_records]
    if not ids:
        print(f"  [{parish}] no bulk source and no seed parcel IDs (set ASSESSOR_SEED_FILE); nothing pulled")
        summary.update(source="search_ui", records=0, note="no seeds")
        return summary
    print(
        f"  [{parish}] no bulk source; pulling {len(ids)} parcels from search UI "
        f"(<= {session.max_requests} requests/run, {session.min_interval}s apart)"
    )

    def on_record(rec: ParcelRecord, url: str) -> None:
        rec.tax_year = rec.tax_year or tax_year
        con.execute(
            "DELETE FROM assessor_parcels_raw "
            "WHERE parish = ? AND parcel_id = ? AND tax_year = ? AND source_kind = 'search_ui'",
            [parish, rec.parcel_id, rec.tax_year],
        )
        _insert(con, rec, "search_ui", url, fetched_at)

    # Resume state lives in the database as well as the on-disk checkpoint, so a
    # fresh CI runner (no raw dir) still skips parcels already pulled this roll year.
    checkpoint = Checkpoint(config.RAW_DIR / parish / f"checkpoint_{tax_year}.json")
    for (pid,) in con.execute(
        "SELECT DISTINCT parcel_id FROM assessor_parcels_raw "
        "WHERE parish = ? AND tax_year = ? AND source_kind = 'search_ui'",
        [parish, tax_year],
    ).fetchall():
        checkpoint.done.setdefault(pid, "parsed")
    stats = pull_parcels(adapter, ids, session, config.RAW_DIR, on_record, checkpoint=checkpoint)
    summary.update(source="search_ui", records=stats.parsed, stats=stats.__dict__)
    print(f"  [{parish}] search UI: {stats}")
    return summary


def build_derived(con: duckdb.DuckDBPyConnection) -> None:
    """assessor_parcels = latest record per (parish, parcel_id); assessed_value_history = per tax year."""
    ensure_tables(con)
    cols = ", ".join(PARCEL_FIELDS)
    con.execute(
        f"""
        CREATE OR REPLACE TABLE assessor_parcels AS
        SELECT {cols}, source_kind, source_url, fetched_at
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY parish, parcel_id
                ORDER BY tax_year DESC NULLS LAST, fetched_at DESC
            ) AS rn
            FROM assessor_parcels_raw
        ) WHERE rn = 1
        ORDER BY parish, parcel_id
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE assessed_value_history AS
        SELECT parish, parish_fips, parcel_id, tax_year, land_val, bld_val, tot_mkt_val, assessed_val,
               homestead_exempt_val, taxable_val, source_kind, fetched_at
        FROM (
            SELECT *, ROW_NUMBER() OVER (
                PARTITION BY parish, parcel_id, tax_year ORDER BY fetched_at DESC
            ) AS rn
            FROM assessor_parcels_raw
            WHERE tax_year IS NOT NULL
        ) WHERE rn = 1
        ORDER BY parish, parcel_id, tax_year
        """
    )
    for t in ("assessor_parcels", "assessed_value_history"):
        n = con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {t}: {n} rows")


def load(con: duckdb.DuckDBPyConnection, parishes=("jefferson", "orleans"), **kwargs) -> list[dict]:
    out = [load_parish(con, p, **kwargs) for p in parishes]
    n = geocode.backfill_zip_city(con)
    print(f"  geocode: filled zip/city on {n} rows from lat/lng")
    build_derived(con)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description="Assessor leg: Jefferson + Orleans parcel pull")
    ap.add_argument("--parish", choices=list(config.PARISHES), action="append")
    ap.add_argument("--tax-year", type=int)
    ap.add_argument("--seed-file")
    ap.add_argument("--force-search-ui", action="store_true", help="skip bulk probes")
    ap.add_argument("--max-records", type=int, help="cap records per parish (smoke tests)")
    ap.add_argument("--db", default=str(config.DB_PATH))
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    con = duckdb.connect(args.db)
    load(
        con,
        parishes=tuple(args.parish or config.PARISHES),
        tax_year=args.tax_year,
        seed_file=args.seed_file,
        force_search_ui=args.force_search_ui,
        max_records=args.max_records,
    )
    con.close()


if __name__ == "__main__":
    main()
