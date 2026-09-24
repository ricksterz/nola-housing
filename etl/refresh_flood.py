"""Refresh FEMA flood zones per parcel and rebuild the join; runs monthly on its own.

See .github/workflows/refresh-flood.yml and etl/load_flood.py.

    python -m etl.refresh_flood
"""

import argparse

import duckdb

from . import build_join, config, db_compact, load_flood


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--parish", choices=list(config.PARISHES), action="append")
    args = ap.parse_args(argv)

    con = duckdb.connect(args.db)
    print("Refreshing FEMA flood zones...")
    load_flood.load(con, parishes=args.parish)
    print("Rebuilding join...")
    build_join.build(con)
    print("Compacting database (DuckDB's VACUUM doesn't reclaim space; a raw copy does)...")
    db_compact.compact(con, args.db)
    print("Done.")


if __name__ == "__main__":
    main()
