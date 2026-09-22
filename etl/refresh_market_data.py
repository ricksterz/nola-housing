"""Refresh the market legs (Redfin, Zillow, FRED) and rebuild the join; assessor data untouched.

Intended to run monthly via GitHub Actions (Redfin/Zillow publish monthly; the quarterly and
annual FRED HPI series simply pick up new observations when they appear):

    python -m etl.refresh_market_data
"""

import argparse

import duckdb

from . import build_join, config, db_compact, load_fred, load_redfin, load_zillow


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--only", choices=["redfin", "zillow", "fred"], action="append")
    args = ap.parse_args(argv)
    only = set(args.only or ["redfin", "zillow", "fred"])

    con = duckdb.connect(args.db)
    if "redfin" in only:
        print("Refreshing Redfin market data...")
        load_redfin.load(con)
    if "zillow" in only:
        print("Refreshing Zillow ZHVI/ZORI...")
        load_zillow.load(con)
    if "fred" in only:
        print("Refreshing FRED series...")
        load_fred.load(con)
    print("Rebuilding join...")
    build_join.build(con)
    print("Compacting database (DuckDB's VACUUM doesn't reclaim space; a raw copy does)...")
    db_compact.compact(con, args.db)
    print("Done.")


if __name__ == "__main__":
    main()
