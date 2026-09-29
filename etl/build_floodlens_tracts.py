"""Build etl/data/floodlens_tracts.geojson: FloodLens's validated signal, as census tracts.

FloodLens (github.com/ricksterz/floodlens) scores flood risk; its NFIP backtest found one claim
that holds up: inside FEMA's high-risk (A-family) zones, census tracts in FloodLens's top score
fifth filed flood-insurance claims at about 3x the rate of the rest. The lower four fifths don't
order (claim rates within ~3-5 per 1,000 policy-years), so the site shows a top-fifth flag, not a
0-100 score, and says nothing about Zone X (the backtest there was inconclusive).

This reproduces the backtest's own within-A quintile assignment with FloodLens's code (the
pre-registered v4 tract scores, exposure-weighted cut, tracts with >= 50 policy-years), attaches
each tract's Census TIGER outline (2010 or 2020 vintage, as the backtest keyed it), and writes
one GeoJSON the export joins parcels to. It needs a local FloodLens checkout with its backtest
data, so it's run by hand after FloodLens's monthly refresh, and the output is committed:

    ~/floodlens/venv/bin/python -m etl.build_floodlens_tracts --floodlens ~/floodlens

(FloodLens's venv, since its backtest code needs numpy; run from this repo's root.)
"""

import argparse
import json
import os
import sys
from datetime import date
from pathlib import Path

import duckdb

from . import config

OUT_PATH = config.ETL_DIR / "data" / "floodlens_tracts.geojson"

# The pre-registered result (FloodLens backtest/results/REPORT.md, run 2026-07-04, model v4):
# the number to quote. Later monthly re-checks use the same model on newer claims.
PRE_REGISTERED = {
    "model": "FloodLens v4",
    "window": "2010–2024",
    "claims": 9402,
    "top_vs_bottom": 3.19,
    "ci": [3.00, 3.41],
}


def within_a_tracts(floodlens: Path, year_max: int) -> list[dict]:
    """Tract -> within-A quintile, exactly as FloodLens's backtest computes it."""
    os.environ["BT_YEAR_MAX"] = str(year_max)
    sys.path.insert(0, str(floodlens))
    from backtest import run_backtest as bt  # noqa: PLC0415 - FloodLens's own module

    scores, _ = bt.load_tract_scores()
    all_geoids = {**scores["2020"], **scores["2010"]}  # 2010 wins, as in the backtest
    claims, _ = bt.load_claims(scores)
    py, _ = bt.load_policy_years(scores)
    stats = bt.build_tract_stats(claims, py, family="A")
    stats = {g: v for g, v in stats.items() if v["py"] >= 50 and g in all_geoids}
    for g, v in stats.items():
        v["score"] = all_geoids[g]
    quintile = bt.quintile_cut(stats)
    return [
        {
            "geoid": g,
            "vintage": "2010" if g in scores["2010"] else "2020",
            "quintile": q + 1,
            "score": round(stats[g]["score"], 1),
            "policy_years": round(stats[g]["py"]),
            "claims": stats[g]["claims"],
        }
        for g, q in sorted(quintile.items())
    ]


def claim_rates(tracts: list[dict]) -> dict:
    """Claims per 1,000 policy-years by quintile, plus top fifth vs the rest and vs the bottom."""
    by_q = {}
    for t in tracts:
        agg = by_q.setdefault(t["quintile"], [0, 0])
        agg[0] += t["claims"]
        agg[1] += t["policy_years"]
    rate = {q: round(c / p * 1000, 2) for q, (c, p) in sorted(by_q.items())}
    rest_c = sum(c for q, (c, _) in by_q.items() if q != 5)
    rest_p = sum(p for q, (_, p) in by_q.items() if q != 5)
    rest = round(rest_c / rest_p * 1000, 2)
    return {
        "per_1000_policy_years": rate,
        "rest": rest,
        "top_vs_rest": round(rate[5] / rest, 2),
        "top_vs_bottom": round(rate[5] / rate[1], 2),
    }


def tract_shapes(con, tracts: list[dict], tiger: dict[str, Path]) -> dict[tuple, str]:
    """(vintage, geoid) -> simplified GeoJSON geometry string."""
    out = {}
    for vintage, path in tiger.items():
        field = "GEOID10" if vintage == "2010" else "GEOID"
        wanted = [t["geoid"] for t in tracts if t["vintage"] == vintage]
        if not wanted:
            continue
        marks = ", ".join("?" for _ in wanted)
        for geoid, geom in con.execute(
            f"""SELECT {field}, ST_AsGeoJSON(ST_SimplifyPreserveTopology(geom, 0.0001))
                FROM ST_Read(?) WHERE {field} IN ({marks})""",
            [str(path), *wanted],
        ).fetchall():
            out[(vintage, geoid)] = geom
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--floodlens", type=Path, default=Path.home() / "floodlens")
    ap.add_argument("--year-max", type=int, default=date.today().year - 1, help="last loss year")
    ap.add_argument("--out", type=Path, default=OUT_PATH)
    args = ap.parse_args(argv)

    shapes_dir = args.floodlens / "data" / "backtest" / "shapes"
    tiger = {
        "2010": shapes_dir / "tl2010" / "tl_2010_22_tract10.shp",
        "2020": shapes_dir / "tl2020" / "tl_2020_22_tract.shp",
    }
    tracts = within_a_tracts(args.floodlens, args.year_max)
    rates = claim_rates(tracts)
    con = duckdb.connect()
    con.execute("INSTALL spatial; LOAD spatial")
    shapes = tract_shapes(con, tracts, tiger)
    missing = [t["geoid"] for t in tracts if (t["vintage"], t["geoid"]) not in shapes]
    if missing:
        raise SystemExit(f"no TIGER outline for {len(missing)} tracts: {missing[:5]}")

    doc = {
        "type": "FeatureCollection",
        "floodlens": {
            "generated": date.today().isoformat(),
            "model": PRE_REGISTERED["model"],
            "zone_family": "A (FEMA high-risk, inside the SFHA)",
            "window": f"2010–{args.year_max}",
            "tracts": len(tracts),
            "top_fifth_tracts": sum(t["quintile"] == 5 for t in tracts),
            "rates": rates,
            "pre_registered": PRE_REGISTERED,
        },
        "features": [
            {
                "type": "Feature",
                "properties": {k: t[k] for k in ("geoid", "vintage", "quintile", "score")},
                "geometry": json.loads(shapes[(t["vintage"], t["geoid"])]),
            }
            for t in tracts
        ],
    }
    args.out.write_text(json.dumps(doc, separators=(",", ":")))
    print(
        f"wrote {args.out}: {len(tracts)} tracts, {doc['floodlens']['top_fifth_tracts']} in the top fifth; "
        f"top fifth {rates['per_1000_policy_years'][5]} vs rest {rates['rest']} claims/1,000 policy-years "
        f"({rates['top_vs_rest']}x; top vs bottom {rates['top_vs_bottom']}x)"
    )


if __name__ == "__main__":
    main()
