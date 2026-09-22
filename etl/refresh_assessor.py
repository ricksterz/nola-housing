"""Refresh the assessor leg for one or both parishes and rebuild the join.

Cadence (see .github/workflows/refresh-assessor.yml):
    orleans    Jul 15 – Aug 15 open-rolls window: pull at window open (preliminary values)
               and again after close (final).
    jefferson  annual: after rolls are certified following the Aug 15 – Sep 15 inspection period.

    python -m etl.refresh_assessor --parish orleans
    python -m etl.refresh_assessor --auto      # pick parish(es) from today's date
"""

import argparse
from datetime import date

import duckdb

from . import build_join, config, db_compact, load_assessor


def parishes_in_window(today: date | None = None) -> list[str]:
    today = today or date.today()
    out = []
    for parish, meta in config.PARISHES.items():
        start = date(today.year, *map(int, meta["refresh_window"]["start"].split("-")))
        end = date(today.year, *map(int, meta["refresh_window"]["end"].split("-")))
        if start <= today <= end:
            out.append(parish)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(config.DB_PATH))
    ap.add_argument("--parish", choices=list(config.PARISHES), action="append")
    ap.add_argument("--auto", action="store_true", help="refresh whichever parish is in its window today")
    ap.add_argument("--tax-year", type=int)
    ap.add_argument("--force-search-ui", action="store_true")
    ap.add_argument("--max-records", type=int)
    args = ap.parse_args(argv)

    parishes = args.parish or (parishes_in_window() if args.auto else list(config.PARISHES))
    if not parishes:
        print("No parish is in its refresh window today; nothing to do.")
        return

    con = duckdb.connect(args.db)
    print(f"Refreshing assessor data for: {', '.join(parishes)}")
    load_assessor.load(
        con,
        parishes=tuple(parishes),
        tax_year=args.tax_year,
        force_search_ui=args.force_search_ui,
        max_records=args.max_records,
    )
    print("Rebuilding join...")
    build_join.build(con)
    print("Compacting database (DuckDB's VACUUM doesn't reclaim space; a raw copy does)...")
    db_compact.compact(con, args.db)
    print("Done.")


if __name__ == "__main__":
    main()
