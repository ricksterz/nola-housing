"""Report which official assessor bulk options answer, without loading anything.

    python -m etl.probe_assessor_bulk [--parish jefferson|orleans]

Run this first in each refresh window: if a probe comes back OK the assessor leg
uses it and the search-UI batch pull is never touched.
"""

import argparse

from . import config
from .assessor import bulk
from .assessor.http import PoliteSession


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--parish", choices=list(config.PARISHES), action="append")
    args = ap.parse_args(argv)
    session = PoliteSession(raw_dir=config.RAW_DIR, max_requests=50)
    for parish in args.parish or config.PARISHES:
        print(f"{parish}:")
        for res in bulk.probe_candidates(config.ASSESSOR_SOURCES[parish]["bulk_candidates"], session):
            status = "OK" if res.ok else "no"
            extra = f" ({res.record_count} records)" if res.record_count is not None else ""
            print(f"  [{status}] {res.kind} {res.url}{extra}: {res.reason}")
            if res.field_map:
                print(f"       field map: {res.field_map}")


if __name__ == "__main__":
    main()
