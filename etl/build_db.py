"""Build nola_housing.duckdb from all four sources, then the joined parcel + market schema.

    python -m etl.build_db [--skip-assessor] [--skip-fred]

Mirrors the Houston ``etl/build_db.py``: one loader per source, each owning one raw table.
"""

import argparse

import duckdb

from . import build_join, config, load_assessor, load_fred, load_redfin, load_zillow


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--skip-assessor", action="store_true")
    ap.add_argument("--skip-fred", action="store_true")
    ap.add_argument("--assessor-max-records", type=int)
    args = ap.parse_args(argv)

    con = duckdb.connect(args.db)

    print("Loading Redfin market trackers (county / metro / zip)...")
    load_redfin.load(con)

    print("Loading Zillow ZHVI + ZORI (metro / county / zip)...")
    load_zillow.load(con)

    if not args.skip_fred:
        print("Loading FRED series...")
        load_fred.load(con)

    if not args.skip_assessor:
        print("Loading assessor parcels (Jefferson + Orleans)...")
        load_assessor.load(con, max_records=args.assessor_max_records)

    print("Building normalized join (geo_dim, market_monthly, macro_index, parcel_market)...")
    build_join.build(con)

    print("\nDone. Tables:")
    for (name,) in con.execute("SHOW TABLES").fetchall():
        cnt = con.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        print(f"  {name}: {cnt} rows")
    con.close()


if __name__ == "__main__":
    main()
