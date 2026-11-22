# NOLA Atlas (nola-housing)

Property and market data for New Orleans and Metairie: a Python ETL into DuckDB, a static
React site on GitHub Pages (nolaatlas.com), and a Cloudflare Worker for link previews. The
README covers layout, setup, data sources and refresh cadence; this file holds the rules that
aren't obvious from the code. Sister services: FloodLens (flood.nolaatlas.com, repo
ricksterz/floodlens) and School Finder (schools.nolaatlas.com).

## Checks before pushing

```bash
.venv/bin/ruff check etl tests && .venv/bin/ruff format --check etl tests   # line length 110
.venv/bin/pytest -q
cd frontend && npx eslint . && npm test && VITE_STATIC_DATA=true npm run build
cd cloudflare/link-previews && npm test
```

Locally, four tests that need DuckDB's `spatial` extension fail when it can't be downloaded
(`test_floodlens` flags and three `test_load_flood` tests); CI runs them. To see a page, export
from a database (`NOLA_DB_PATH=... python -m etl.export_static`), build with
`VITE_STATIC_DATA=true`, run `python -m etl.prerender --dist frontend/dist`, and serve
`frontend/dist`.

## The published database

- It is the `nola_housing.duckdb` asset on the `data` release, not in git
  (`python -m etl.db_store pull`). Only the refresh workflows publish it.
- Derived tables must match the code. `db_store.publish` refuses, and `export_static` (CI and
  the Pages deploy) fails, when `parcel_market` lacks a column in `REQUIRED_COLUMNS`. After a
  change to the assessor tables or the join, add the new column there.
- Any path that runs `load_assessor.build_derived` must also rebuild the join
  (`build_join.build`) before the workflow publishes, or the site shows stale columns.
- Jefferson's `HOMESTEADV` is every exemption combined: it maps to `exempt_val`, not
  `homestead_exempt_val`.
- The data jobs install exact versions from `requirements-jobs.txt`; don't add unpinned
  `pip install` lines to workflows that can push, publish or deploy.

## Copy and display rules

- The promise, wherever it appears (index.html, Home, prerender, og_images, README): "Type
  any New Orleans or Metairie address: see who owns it, how it floods, and which schools are
  near." The short form for the top bar and preview images: "Who owns any address, how it
  floods, and which schools are near." Don't promise a monthly cost: the property report has
  no mortgage calculator (the ZIP Scorecard compares the cost of buying by ZIP).
- Owner names, subdivisions and legal descriptions are shown in title case through
  `frontend/src/lib/names.js` (`titleCase`, `subdivisionName`); `etl/export_owners.py
  display_name` follows the same rules. Initials and company forms stay in capitals.
- Jefferson land, building and assessed values are assessed amounts (10% of the Assessor's
  market value for a home, 15% for a commercial building). Label them as assessed; show the
  ≈ market value (× 10) only for homes (`assessorMarket`).
- The yearly cost line is property tax (assessed minus exemptions, times the ZIP's rate per
  assessed dollar: ACS `full_rate` ÷ 10%) plus the ZIP's median NFIP premium for the parcel's
  zone class. Show it only where the data exists; Orleans has no assessed values yet.
- FloodLens's 0–100 score: always labeled a model estimate, validated only inside FEMA A
  zones. Prominent only in an A zone; elsewhere one small line saying it is untested there.
  State partial input coverage and a preliminary map when they apply (README "FloodLens
  tracts").
- Privacy: searches are never sent to the analytics services. A property's map point does
  go to FloodLens for its flood details, and About says so. Keep that answer true when
  anything new leaves the browser.

## FloodLens from this site

- `frontend/src/lib/links.js` `FLOODLENS_URL` (flood.nolaatlas.com) is both the link target
  and the API base for the flood card's live lookups. FloodLens's CORS allows nolaatlas.com.
- FloodLens runs on Render's free plan and sleeps after 15 idle minutes. The keep-awake ping
  (the Worker cron in `cloudflare/link-previews/src/keepawake.js`, 7 am to midnight Central so
  the account's 750 free hours stretch to its other free services) calls the onrender.com
  address on purpose, so it works whatever happens to the custom domain's DNS. GitHub
  Actions schedules proved unreliable for this (a 5-minute cron never fired).
- The link-preview Worker is not deployed by CI: run `npx wrangler deploy` in
  `cloudflare/link-previews` after changing it.

## Accessibility

Text colors meet WCAG AA (4.5:1) on every surface in both themes; check new color tokens
before using them for text. Panel titles are `h2` under the page's `h1`; scrollable tables
are focusable regions with a label; anything clickable is a button or link (rows get a
button in their first cell). Respect `prefers-reduced-motion`.

## Pull requests

One PR per item, opened as a draft. Ask before merging, before changing Render, DNS or
Cloudflare settings, and before any bulk pull from an assessor site.
