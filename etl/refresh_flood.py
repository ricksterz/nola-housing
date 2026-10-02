"""Refresh FEMA flood zones per parcel and rebuild the join; runs monthly on its own.

See .github/workflows/refresh-flood.yml and etl/load_flood.py.

    python -m etl.refresh_flood
"""

import argparse

import duckdb
import requests

from . import build_join, config, db_compact, load_flood
from .assessor.http import RobotsDisallowed


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--parish", choices=list(config.PARISHES), action="append")
    args = ap.parse_args(argv)

    con = duckdb.connect(args.db)
    print("Refreshing FEMA flood zones...")
    try:
        load_flood.load(con, parishes=args.parish)
    except (RobotsDisallowed, requests.RequestException, RuntimeError) as e:
        # Keep every zone already placed, still carry them over to re-keyed records, and say so
        # loudly: hazards.fema.gov's robots.txt now disallows /arcgis (seen 2026-10-02).
        print(f"::warning::FEMA flood zones not refreshed ({type(e).__name__}: {e}); kept the previous zones")
    load_flood.carry_over_by_lot(con)
    print("Rebuilding join...")
    build_join.build(con)
    print("Compacting database (DuckDB's VACUUM doesn't reclaim space; a raw copy does)...")
    db_compact.compact(con, args.db)
    print("Done.")


if __name__ == "__main__":
    main()
