# nola-housing

Multi-source property + market data ETL for **Jefferson Parish (Metairie / Old
Metairie)** and **Orleans Parish (New Orleans)**. It is the New Orleans–Metairie
counterpart of the Houston job in
[HoustonHousingApp](https://github.com/ricksterz/HoustonHousingApp) (HCAD +
Redfin + Zillow + FRED) and runs on the same framework: plain Python loaders,
one DuckDB table per source, `build_db` / `refresh_*` orchestrators, GitHub
Actions cron schedules, ruff in CI.

| Houston leg | New Orleans–Metairie leg | Lands in |
|---|---|---|
| HCAD bulk files | Jefferson Parish Assessor (jpassessor.net) + Orleans Parish Assessor (nolaassessor.com) | `assessor_parcels_raw` → `assessor_parcels`, `assessed_value_history` |
| Redfin ZIP tracker | Redfin county (FIPS 22051/22071), metro (CBSA 35380) and ZIP trackers | `redfin_market` |
| Zillow ZHVI (ZIP) | Zillow ZHVI + ZORI at metro / county / ZIP | `zillow_index` |
| FRED Houston series | `ATNHPIUS35380Q`, `ATNHPIUS22051A`, `ATNHPIUS22071A`, `MORTGAGE30US` (+ realtor.com MSA series) | `fred_series`, `macro_snapshot` |

All four join on normalized keys: `geo_level` ∈ {`zip`, `county`, `metro`} and
`geo_id` = 5-digit ZIP / parish FIPS / CBSA code (`etl/config.py`).

## Layout

```
etl/
  config.py              parishes, FIPS, CBSA, target ZIPs, FRED series, feed URLs, rate limits
  load_redfin.py         Redfin Data Center TSVs (public S3 bucket)      -> redfin_market
  load_zillow.py         Zillow Research CSVs, unpivoted                 -> zillow_index
  fred_client.py         FRED API client (same auth/cache pattern as Houston)
  load_fred.py           full series history + latest snapshot           -> fred_series, macro_snapshot
  load_assessor.py       assessor leg (bulk probe first, search UI fallback)
  assessor/
    http.py              polite session: UA, robots.txt, rate limit, backoff, budget, raw landing
    bulk.py              ArcGIS REST + Socrata probes/fetchers
    search_ui.py         checkpointed batch pull of detail pages
    parse.py             stdlib HTML label/value + table extraction
    jefferson.py         jpassessor.net adapter (URL template + label aliases)
    orleans.py           nolaassessor.com adapter (tax bill number keyed)
  build_join.py          geo_dim, market_monthly, macro_index, parcel_market + Houston-compatible views
  build_db.py            full build (all legs + join)
  refresh_market_data.py monthly: Redfin + Zillow + FRED, rebuild join
  refresh_assessor.py    assessor leg on the parish calendars, rebuild join
  probe_assessor_bulk.py report which official bulk options answer
tests/                   fixture-backed tests for every loader, the assessor fallbacks and the join
.github/workflows/       ci.yml, refresh-market-data.yml, refresh-assessor.yml
```

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # FRED_API_KEY, ASSESSOR_CONTACT
```

## Run

```bash
python -m etl.build_db                      # everything -> etl/nola_housing.duckdb
python -m etl.build_db --skip-assessor      # market legs only
python -m etl.refresh_market_data           # Redfin + Zillow + FRED, rebuild join
python -m etl.refresh_assessor --parish orleans --tax-year 2026
python -m etl.refresh_assessor --auto       # whichever parish is in its window today
python -m etl.probe_assessor_bulk           # which official bulk options answer?
python -m pytest -q && ruff check etl tests # what CI runs
```

Offline development: point the feeds at local files with
`REDFIN_{COUNTY,METRO,ZIP}_SOURCE`, `ZILLOW_SOURCE_DIR`; the fixtures under
`tests/fixtures/` work as-is:

```bash
REDFIN_COUNTY_SOURCE=tests/fixtures/county_market_tracker.tsv \
REDFIN_METRO_SOURCE=tests/fixtures/redfin_metro_market_tracker.tsv \
REDFIN_ZIP_SOURCE=tests/fixtures/zip_code_market_tracker.tsv \
ZILLOW_SOURCE_DIR=tests/fixtures/zillow \
python -m etl.build_db --db /tmp/smoke.duckdb --skip-assessor
```

## App (backend + frontend)

**NOLA Housing Pulse** is the New Orleans–Metairie counterpart of heightscomps.com, on the same stack (FastAPI
over DuckDB; Vite + React + recharts; static export for GitHub Pages) with a
wider feature set:

| View | What it shows |
|---|---|
| Market Overview | One area at a time (metro, parish or any of 24 ZIPs): KPI tiles with YoY deltas and sparklines, then home value vs. sale price, rent, DOM, listings pipeline, inventory, months of supply, $/sqft and negotiation charts. Every chart has a table twin. |
| ZIP Scorecard | All ZIPs side by side: latest reading, YoY, heat-shaded cells (one-hue ramp for magnitude, blue/red for change), 24-month sparkline; sortable, filter by parish; click through to the overview. Plus gross rent yield (rent vs. buy) and monthly payment on the median sale at an adjustable rate. |
| Compare | Overlay up to six areas on one metric, optionally indexed to 100, with small multiples. Colors are bound to the area, not its rank. |
| Macro | Metro vs. parish ZHVI/ZORI indexed; with FRED loaded: 30-yr mortgage rate, FHFA HPI (metro, Jefferson, Orleans) and realtor.com listing series. |
| Property Lookup | Assessor parcel record, value history, indicative value from the ZIP's $/sqft, ZIP market context. |

Charts follow the dataviz rules in this repo's tooling: no dual axes, a fixed
8-slot categorical palette validated for color-vision deficiency in both themes,
hairline grids, 2px lines, and a table view behind every chart.

```bash
# Backend (reads etl/nola_housing.duckdb)
pip install -r backend/requirements.txt
uvicorn backend.main:app --port 8000

# Frontend (dev, against the backend)
cd frontend && npm install && npm run dev

# Static site (GitHub Pages / previews): bake JSON, then build
python -m etl.export_static
cd frontend && VITE_STATIC_DATA=true npm run build   # add VITE_BASE=/nola-housing/ for Pages
```

`etl/export_static.py` writes `frontend/public/data/` (meta, macro, scorecard,
compare, per-geography trends, per-parcel JSON). `deploy-pages.yml` runs it and
deploys after every push to `main` and after each successful data refresh; enable
Pages in **Settings → Pages → Source: GitHub Actions**.

API: `GET /api/market/trend?geo_level=zip&geo_id=70005`, `/api/market/compare`,
`/api/market/scorecard`, `/api/market/macro_index`, `/api/macro/snapshot`,
`/api/property/lookup?address=`, `/api/property/suggest?q=`, `/api/meta`.

## Output schema

Shared "parcel + market" schema (what the comps app reads):

| Table / view | Grain | Notes |
|---|---|---|
| `parcel_market` | one row per parcel | parcel ID, tax bill #, address, lat/lng, owner, legal, current values, `assessed_value_history` (list of `{tax_year, assessed_val, tot_mkt_val}`), latest ZIP Redfin comps + ZHVI/ZORI, parish HPI, metro HPI, 30-yr mortgage rate |
| `market_monthly` | (geo_level, geo_id, month) | Redfin + ZHVI + ZORI aligned; parish/CBSA parent keys |
| `macro_index` | date | FRED series pivoted to columns |
| `geo_dim` | (geo_level, geo_id) | ZIP → parish FIPS → CBSA roll-up |
| `assessor_parcels` | (parish, parcel_id) | latest record per parcel |
| `assessed_value_history` | (parish, parcel_id, tax_year) | accumulates across refreshes |
| `hcad_accounts` (view) | parcel | Houston column names over `assessor_parcels` |
| `zhvi_trend`, `zori_trend` (views) | (zip_code, month) | Houston shape |
| `redfin_market_zip` (view) | (zip_code, period) | Houston column set |

The compatibility views mean `backend/routers/market.py`, `property.py` and
`valuation.py` from the Houston app run against this database once
`HOUSING_DB_PATH` points at it and `VALID_ZIPS` is set to the ZIPs in
`etl/config.py` (there is no MLS/HAR leg here, so `mls_listings`-based
valuation needs a comps source or the Redfin `$/sqft` implied value in
`parcel_market.implied_value_redfin_psf`).

Raw source tables keep every column the join needs plus provenance:
`redfin_market`, `zillow_index`, `fred_series`, `assessor_parcels_raw`
(parsed columns + full JSON payload), `assessor_bulk_probes`.

## Refresh cadence

| Leg | Schedule | Workflow |
|---|---|---|
| Redfin, Zillow, FRED | monthly, 06:00 UTC on the 5th | `refresh-market-data.yml` |
| Orleans assessor | daily Jul 15 – Aug 20 (open-rolls window Jul 15 – Aug 15, plus final values) | `refresh-assessor.yml --auto` |
| Jefferson assessor | daily Aug 15 – Sep 30 (inspection Aug 15 – Sep 15, then certification) | `refresh-assessor.yml --auto` |

Both workflows commit `etl/nola_housing.duckdb` back to the repo when it
changes, as the Houston job does. Secrets/vars: `FRED_API_KEY`,
`ASSESSOR_CONTACT` (secret), `ASSESSOR_SEED_FILE`, `ASSESSOR_MAX_REQUESTS_PER_RUN`
(repository variables).

## Assessor leg: how it behaves

Neither parish has a confirmed bulk export. Per parish, every run:

1. **Probes official bulk options first** (`etl/config.py: ASSESSOR_SOURCES`):
   Jefferson's geoportal ArcGIS parcel layer; Orleans' data.nola.gov Socrata
   dataset and NOLA GIS parcel layer. A candidate is used when its fields map
   to a parcel ID plus owner / value / address. Results are logged to
   `assessor_bulk_probes`.
2. **Falls back to the public search UI** only if no probe answers. The pull
   identifies itself (`User-Agent` with `ASSESSOR_CONTACT`), obeys robots.txt,
   spaces requests `ASSESSOR_MIN_INTERVAL_SECONDS` apart (default 3 s), backs
   off on 429/5xx, stops at `ASSESSOR_MAX_REQUESTS_PER_RUN` (default 5000) and
   resumes next run from a checkpoint kept in the database and in `etl/raw/`.
   At the defaults a full parish (~170–180k parcels) via the search UI takes
   about five weeks of daily runs, which is why the workflow runs daily across
   each window. Seeds come from `ASSESSOR_SEED_FILE` (CSV: `parcel_id[,parish]`)
   and from parcel IDs already in the database.

Every response body is landed under `etl/raw/<parish>/` and the parsed label
pairs / value tables are stored as JSON in `assessor_parcels_raw.payload`, so
the normalized columns can be re-derived without another pull.

### First live run checklist (unverified against the live sites)

The development environment for this pipeline had no outbound access to the
assessor sites, Redfin's bucket, Zillow or FRED, so the following are
configured from public documentation and must be confirmed once on a machine
that can reach them:

- `python -m etl.probe_assessor_bulk` — confirm/adjust the ArcGIS layer URLs
  (`JEFFERSON_ARCGIS_PARCELS_URL`, `ORLEANS_ARCGIS_PARCELS_URL`) and the
  Socrata dataset id (`ORLEANS_SOCRATA_DATASET_ID`). Field-name aliases live in
  `etl/assessor/bulk.py: DEFAULT_FIELD_ALIASES`.
- Detail-page URL templates (`JEFFERSON_DETAIL_URL`, `ORLEANS_DETAIL_URL`) and
  the label aliases in `etl/assessor/jefferson.py` / `orleans.py`. Run one
  parcel with `--max-records 1`, open the landed HTML in `etl/raw/`, and add
  any label the page uses that is missing from the alias lists. Check each
  site's terms of use before scaling the pull.
- Redfin tracker object names (`*_market_tracker.tsv000.gz`) and the
  `region` spellings (`Jefferson Parish, LA`, `New Orleans, LA metro area`,
  `Zip Code: 70005`) in `etl/load_redfin.py`.
- Zillow file names in `etl/config.py: ZILLOW_FILES` and the metro
  `RegionName` (`New Orleans, LA`, RegionType `msa`).
- FRED realtor.com series ids for CBSA 35380 (the four required series are
  standard FRED ids).

## Data sources

- Jefferson Parish Assessor — https://www.jpassessor.net/
- Orleans Parish Assessor — https://nolaassessor.com/
- Redfin Data Center — https://www.redfin.com/news/data-center/ (bucket `redfin-public-data`)
- Zillow Research — https://www.zillow.com/research/data/
- FRED — https://fred.stlouisfed.org/ (API key required)
