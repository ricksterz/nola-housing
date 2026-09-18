"""Pipeline configuration for the New Orleans–Metairie property + market ETL.

This is the second pipeline config alongside the Houston job (HCAD + Redfin +
Zillow + FRED). Everything geography-specific lives here so the loaders stay
generic: parishes (Louisiana's counties), their FIPS codes, the CBSA, the target
ZIPs, the FRED series, and the public feed URLs.

Normalized join keys used across every table:
    geo_level  in ('zip', 'county', 'metro')
    geo_id     = 5-digit ZIP | 5-digit county FIPS | 5-digit CBSA code
"""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ETL_DIR = ROOT / "etl"
RAW_DIR = Path(os.environ.get("NOLA_RAW_DIR", ETL_DIR / "raw"))
DB_PATH = Path(os.environ.get("NOLA_DB_PATH", ETL_DIR / "nola_housing.duckdb"))

# ---------------------------------------------------------------------------
# Geography
# ---------------------------------------------------------------------------
CBSA_CODE = "35380"
CBSA_NAME = "New Orleans-Metairie, LA"
STATE_FIPS = "22"

PARISHES = {
    "jefferson": {
        "name": "Jefferson Parish",
        "fips": "22051",
        "assessor": "Jefferson Parish Assessor",
        "assessor_url": "https://www.jpassessor.net/",
        # Louisiana rolls are open for public inspection for 15 days between
        # Aug 15 and Sep 15 (La. R.S. 47:1992); Jefferson certifies annually
        # after that, so the annual pull runs in late September.
        "refresh_window": {"start": "08-15", "end": "09-30"},
    },
    "orleans": {
        "name": "Orleans Parish",
        "fips": "22071",
        "assessor": "Orleans Parish Assessor",
        "assessor_url": "https://nolaassessor.com/",
        # Orleans is the statutory exception: rolls open Jul 15 – Aug 15.
        "refresh_window": {"start": "07-15", "end": "08-15"},
    },
}
PARISH_FIPS = {k: v["fips"] for k, v in PARISHES.items()}
FIPS_TO_PARISH = {v["fips"]: k for k, v in PARISHES.items()}

# Redfin spells county regions as "<Name> Parish, LA"; Zillow as "<Name> Parish".
REDFIN_COUNTY_REGIONS = {f"{v['name']}, LA": v["fips"] for v in PARISHES.values()}
ZILLOW_COUNTY_NAMES = {v["name"]: v["fips"] for v in PARISHES.values()}

# Target ZIPs. Metairie / Old Metairie (Jefferson) and New Orleans proper (Orleans).
# 70121 (Old Jefferson) and 70123 (Harahan/River Ridge) border Old Metairie and
# are Jefferson Parish; keep them so Redfin/Zillow ZIP series cover the whole
# east-bank Jefferson corridor the comps app cares about.
ZIPS_BY_PARISH = {
    "jefferson": (
        "70001",  # Metairie
        "70002",  # Metairie
        "70003",  # Metairie
        "70005",  # Old Metairie
        "70006",  # Metairie
        "70121",  # Old Jefferson
        "70123",  # Harahan / River Ridge
    ),
    "orleans": (
        "70112",
        "70113",
        "70114",
        "70115",
        "70116",
        "70117",
        "70118",
        "70119",
        "70122",
        "70124",
        "70125",
        "70126",
        "70127",
        "70128",
        "70129",
        "70130",
        "70131",
    ),
}
ZIPS = tuple(z for zips in ZIPS_BY_PARISH.values() for z in zips)
ZIP_TO_PARISH_FIPS = {z: PARISH_FIPS[p] for p, zips in ZIPS_BY_PARISH.items() for z in zips}

# ---------------------------------------------------------------------------
# Redfin Data Center (public S3 bucket, not a scrape). Same feeds the Houston
# job uses; the *.tsv000.gz objects are the current names of the TSV trackers.
# ---------------------------------------------------------------------------
REDFIN_BASE = "https://redfin-public-data.s3-us-west-2.amazonaws.com/redfin_market_tracker/"
REDFIN_SOURCES = {
    "county": os.environ.get("REDFIN_COUNTY_SOURCE", REDFIN_BASE + "county_market_tracker.tsv000.gz"),
    "metro": os.environ.get("REDFIN_METRO_SOURCE", REDFIN_BASE + "redfin_metro_market_tracker.tsv000.gz"),
    "zip": os.environ.get("REDFIN_ZIP_SOURCE", REDFIN_BASE + "zip_code_market_tracker.tsv000.gz"),
}
REDFIN_METRO_REGION_PREFIX = "New Orleans"  # Redfin: "New Orleans, LA metro area"

# ---------------------------------------------------------------------------
# Zillow Research (zillow.com/research/data)
# ---------------------------------------------------------------------------
ZILLOW_BASE = "https://files.zillowstatic.com/research/public_csvs/"
ZILLOW_FILES = {
    # (index, geo_level) -> file name
    ("zhvi", "metro"): "zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    ("zhvi", "county"): "zhvi/County_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    ("zhvi", "zip"): "zhvi/Zip_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv",
    ("zori", "metro"): "zori/Metro_zori_uc_sfrcondomfr_sm_month.csv",
    ("zori", "county"): "zori/County_zori_uc_sfrcondomfr_sm_month.csv",
    ("zori", "zip"): "zori/Zip_zori_uc_sfrcondomfr_sm_month.csv",
}
ZILLOW_METRO_REGION_NAME = "New Orleans, LA"  # RegionType 'msa' in the Metro files


def zillow_source(index: str, geo_level: str) -> str:
    """Public URL for a Zillow file, or a local path when ZILLOW_SOURCE_DIR is set."""
    rel = ZILLOW_FILES[(index, geo_level)]
    local_dir = os.environ.get("ZILLOW_SOURCE_DIR")
    if local_dir:
        return str(Path(local_dir) / Path(rel).name)
    return ZILLOW_BASE + rel


# ---------------------------------------------------------------------------
# FRED — Louisiana equivalents of the Houston (CBSA 26420) series.
# ---------------------------------------------------------------------------
FRED_SERIES = {
    # key -> (series_id, geo_level, geo_id, frequency)
    "mortgage_rate_30yr": ("MORTGAGE30US", "national", "US", "weekly"),
    "nola_metro_hpi": ("ATNHPIUS35380Q", "metro", CBSA_CODE, "quarterly"),
    "jefferson_hpi": ("ATNHPIUS22051A", "county", "22051", "annual"),
    "orleans_hpi": ("ATNHPIUS22071A", "county", "22071", "annual"),
    # Realtor.com market series for the MSA, same family the Houston macro header uses.
    "nola_median_list_price": ("MEDLISPRI35380", "metro", CBSA_CODE, "monthly"),
    "nola_active_listings": ("ACTLISCOU35380", "metro", CBSA_CODE, "monthly"),
    "nola_new_listings": ("NEWLISCOU35380", "metro", CBSA_CODE, "monthly"),
    "nola_price_reduced": ("PRIREDCOU35380", "metro", CBSA_CODE, "monthly"),
    "nola_median_dom": ("MEDDAYONMAR35380", "metro", CBSA_CODE, "monthly"),
    "nola_list_price_sqft": ("MEDLISPRIPERSQUFEE35380", "metro", CBSA_CODE, "monthly"),
}
FRED_OBSERVATION_START = "1990-01-01"

# ---------------------------------------------------------------------------
# Assessor leg. Neither parish has a confirmed bulk export, so each parish has
# (1) candidate official bulk endpoints that are probed first and (2) a search
# UI fallback that is batch-pulled under strict rate limits. Endpoints are
# overridable via env so they can be corrected without a code change once
# confirmed against the live sites.
# ---------------------------------------------------------------------------
ASSESSOR_CONTACT = os.environ.get("ASSESSOR_CONTACT", "")
ASSESSOR_USER_AGENT = (
    "nola-housing-etl/0.1 (+https://github.com/ricksterz/nola-housing"
    + (f"; {ASSESSOR_CONTACT}" if ASSESSOR_CONTACT else "")
    + ")"
)
# Polite defaults: ~1 request every 3 s, a daily budget, and a per-run cap so a
# full-parish batch is spread across the refresh window instead of hammering.
ASSESSOR_MIN_INTERVAL_SECONDS = float(os.environ.get("ASSESSOR_MIN_INTERVAL_SECONDS", "3.0"))
ASSESSOR_MAX_REQUESTS_PER_RUN = int(os.environ.get("ASSESSOR_MAX_REQUESTS_PER_RUN", "5000"))
ASSESSOR_TIMEOUT_SECONDS = 30
ASSESSOR_SEED_FILE = os.environ.get("ASSESSOR_SEED_FILE")

ASSESSOR_SOURCES = {
    "jefferson": {
        # Candidate official bulk options, probed in order. Jefferson Parish
        # publishes GIS through its geoportal; a parcel FeatureServer/MapServer
        # layer there is the most likely sanctioned bulk path.
        "bulk_candidates": [
            {
                "kind": "arcgis",
                "url": os.environ.get(
                    "JEFFERSON_ARCGIS_PARCELS_URL",
                    "https://geoportal.jeffparish.net/public/rest/services/Parcels/MapServer/0",
                ),
            },
        ],
        "search_ui": {
            "base_url": os.environ.get("JEFFERSON_SEARCH_BASE_URL", "https://www.jpassessor.net/"),
            # {parcel_id} is substituted; path confirmed on first live run.
            "detail_url": os.environ.get(
                "JEFFERSON_DETAIL_URL", "https://www.jpassessor.net/property-search/?parcel={parcel_id}"
            ),
        },
    },
    "orleans": {
        "bulk_candidates": [
            # City of New Orleans open data (Socrata). Parcel layer carries the
            # assessor's tax bill number / owner / values in some vintages.
            {
                "kind": "socrata",
                "domain": os.environ.get("ORLEANS_SOCRATA_DOMAIN", "data.nola.gov"),
                "dataset_id": os.environ.get("ORLEANS_SOCRATA_DATASET_ID", ""),
            },
            {
                "kind": "arcgis",
                "url": os.environ.get(
                    "ORLEANS_ARCGIS_PARCELS_URL",
                    "https://gis.nola.gov/arcgis/rest/services/apps/Parcels/MapServer/0",
                ),
            },
        ],
        "search_ui": {
            "base_url": os.environ.get("ORLEANS_SEARCH_BASE_URL", "https://nolaassessor.com/"),
            "detail_url": os.environ.get(
                "ORLEANS_DETAIL_URL", "https://nolaassessor.com/search/?tax_bill={parcel_id}"
            ),
        },
    },
}
