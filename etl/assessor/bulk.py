"""Official bulk-data probes: ArcGIS REST parcel layers and Socrata (data.nola.gov) datasets.

Both are checked before any search-UI scraping. A candidate "works" when it
answers with layer/dataset metadata whose fields can be mapped to at least a
parcel ID and one of (owner, assessed value, address). Records are fetched with
pagination and returned as ParcelRecords with WGS84 centroids where geometry is
available.
"""

import logging
from dataclasses import dataclass

from .base import ParcelRecord, map_aliases, record_from_mapping
from .http import PoliteSession

log = logging.getLogger(__name__)

# Field-name aliases seen across Louisiana parcel layers. Case-insensitive.
DEFAULT_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "parcel_id": (
        "PARCEL_ID",
        "PARCELID",
        "PIN",
        "GEOPIN",
        "PARCEL_NO",
        "PARCELNO",
        "PARCEL",
        "APN",
        "ASSESSMENT_NUMBER",
        "TAXROLLPAR",  # Jefferson PAO_MAP_2025: 10-digit tax roll parcel number
    ),
    "tax_bill_number": (
        "TAX_BILL",
        "TAXBILL",
        "TAX_BILL_NO",
        "TAXBILLNO",
        "BILL_NUMBER",
        "TAX_BILL_NUMBER",
        "TAXBILLID",  # Orleans ParcelSearch
    ),
    "site_address": (
        "SITE_ADDR",
        "SITUS",
        "SITUS_ADDRESS",
        "LOCATION",
        "PROPERTY_ADDRESS",
        "ADDRESS",
        "FULL_ADDRESS",
        "SITEADDRESS",
        "PARCELADDR",  # Jefferson PAO_MAP_2025
    ),
    "city": ("CITY", "SITUS_CITY", "MUNICIPALITY"),
    "zip_code": ("ZIP", "ZIPCODE", "ZIP_CODE", "SITUS_ZIP", "POSTAL"),
    "owner_name": ("OWNER", "OWNER_NAME", "OWNERNAME", "OWNER1", "TAXPAYER", "OWNERNME1"),
    "mailing_address": ("MAIL_ADDR", "MAILING_ADDRESS", "OWNER_ADDRESS", "MAILADDRESS"),
    "legal_description": ("LEGAL", "LEGAL_DESC", "LEGAL_DESCRIPTION", "LGL_DESC"),
    "subdivision": ("SUBDIVISION", "SUBDIV", "SUBDIVISION_NAME", "PARCELSUBD"),
    "property_class": ("PROP_CLASS", "PROPERTY_CLASS", "CLASS", "LAND_USE", "USE_CODE", "PROPERTY_TYPE"),
    "land_area": ("LAND_AREA", "LOT_SQFT", "SQ_FT_LAND", "LAND_SQFT", "ACRES", "SHAPE_AREA"),
    "building_area": (
        "BLDG_AREA",
        "BUILDING_AREA",
        "LIVING_AREA",
        "SQFT",
        "SQ_FT",
        "TOTAL_SQFT",
        "HEATED_AREA",
    ),
    "year_built": ("YEAR_BUILT", "YR_BUILT", "YRBUILT", "BUILT"),
    "land_val": ("LAND_VALUE", "LAND_VAL", "LANDVALUE", "LAND_MKT_VAL", "LAND_MARKET_VALUE"),
    "bld_val": (
        "IMPROVEMENT_VALUE",
        "IMPR_VAL",
        "IMP_VALUE",
        "BLDG_VALUE",
        "BUILDING_VALUE",
        "IMPROVEMENTS",
        "IMPROVEMEN",  # Jefferson PAO_MAP_2025 (Esri-truncated "IMPROVEMENT")
    ),
    "tot_mkt_val": (
        "TOTAL_VALUE",
        "TOTAL_MARKET_VALUE",
        "MARKET_VALUE",
        "MKT_VAL",
        "TOT_MKT_VAL",
        "FAIR_MARKET_VALUE",
    ),
    "assessed_val": (
        "ASSESSED_VALUE",
        "ASSESSED_VAL",
        "TOTAL_ASSESSED",
        "TOTAL_ASSESSED_VALUE",
        "ASSESSMENT",
        "ASSD_VAL",
        "ASSESSED_V",  # Jefferson PAO_MAP_2025 (Esri-truncated "ASSESSED_VAL")
    ),
    "homestead_exempt_val": (
        "HOMESTEAD",
        "HOMESTEAD_EXEMPTION",
        "HMSTD_EXEMPT",
        "EXEMPT_VALUE",
        "HOMESTEAD_VALUE",
        "HOMESTEADV",  # Jefferson PAO_MAP_2025
    ),
    "taxable_val": ("TAXABLE_VALUE", "TAXABLE", "NET_ASSESSED", "TAXABLE_ASSESSED"),
    "tax_year": ("TAX_YEAR", "TAXYEAR", "ROLL_YEAR", "ASSESSMENT_YEAR", "YEAR"),
    "last_sale_date": ("SALE_DATE", "LAST_SALE_DATE", "SALEDATE", "DEED_DATE", "TRANSFER_DATE"),
    "zoning": ("ZONING", "ZONING_CODE", "PRIMARY_ZONING", "PRIMARY_ZO"),
    "last_sale_qualified": ("SALE_QUALIFIED", "QUALIFIED_SALE", "QUALIFIED"),
    "last_sale_price": (
        "SALE_PRICE",
        "LAST_SALE_PRICE",
        "SALEPRICE",
        "SALE_AMOUNT",
        "CONSIDERATION",
        "SALESPRICE",
    ),
}

REQUIRED_ANY = ("owner_name", "assessed_val", "tot_mkt_val", "site_address")


@dataclass
class BulkProbeResult:
    kind: str
    url: str
    ok: bool
    reason: str
    field_map: dict | None = None
    record_count: int | None = None


def _mapping_ok(field_map: dict) -> bool:
    return "parcel_id" in field_map and any(k in field_map for k in REQUIRED_ANY)


# ---------------------------------------------------------------------------
# ArcGIS REST
# ---------------------------------------------------------------------------
def probe_arcgis(url: str, session: PoliteSession, aliases: dict | None = None) -> BulkProbeResult:
    aliases = aliases or DEFAULT_FIELD_ALIASES
    try:
        meta = session.get_json(url, params={"f": "json"}, cache_key=f"probe/arcgis_{abs(hash(url))}")
    except Exception as e:  # noqa: BLE001
        return BulkProbeResult("arcgis", url, False, f"metadata request failed: {e}")
    if not isinstance(meta, dict) or "error" in meta or "fields" not in meta:
        return BulkProbeResult("arcgis", url, False, f"no layer metadata: {str(meta)[:120]}")
    names = {f["name"]: f["name"] for f in meta.get("fields", [])}
    field_map = map_aliases(names, aliases)
    if not _mapping_ok(field_map):
        return BulkProbeResult(
            "arcgis", url, False, f"fields not mappable ({sorted(names)[:15]}...)", field_map
        )
    count = None
    try:
        c = session.get_json(
            url.rstrip("/") + "/query", params={"where": "1=1", "returnCountOnly": "true", "f": "json"}
        )
        count = c.get("count")
    except Exception as e:  # noqa: BLE001
        log.info("arcgis count query failed for %s: %s", url, e)
    return BulkProbeResult("arcgis", url, True, "ok", field_map, count)


def _centroid(geom: dict | None) -> tuple[float | None, float | None]:
    if not geom:
        return None, None
    if "x" in geom and "y" in geom:
        return geom["y"], geom["x"]
    rings = geom.get("rings") or geom.get("paths")
    if rings:
        pts = []
        for ring in rings:
            # Polygon rings repeat the first vertex at the end; drop it so the
            # vertex average is not biased toward that corner.
            pts.extend(ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring)
        if pts:
            return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)
    return None, None


def fetch_arcgis(
    url: str,
    session: PoliteSession,
    parish: str,
    parish_fips: str,
    field_map: dict,
    page_size: int = 1000,
    where: str = "1=1",
    max_records: int | None = None,
) -> list[ParcelRecord]:
    """Page through an ArcGIS layer; returns ParcelRecords with WGS84 centroid lat/lng."""
    out: list[ParcelRecord] = []
    offset = 0
    out_fields = ",".join(sorted(set(field_map.values())))
    while True:
        page = session.get_json(
            url.rstrip("/") + "/query",
            params={
                "where": where,
                "outFields": out_fields,
                "returnGeometry": "true",
                "outSR": "4326",
                "resultOffset": offset,
                "resultRecordCount": page_size,
                "f": "json",
            },
            cache_key=f"{parish}/arcgis_page_{offset}",
        )
        features = page.get("features", [])
        for feat in features:
            attrs = feat.get("attributes", {})
            mapped = {target: attrs.get(src) for target, src in field_map.items()}
            lat, lng = _centroid(feat.get("geometry"))
            mapped.setdefault("lat", lat)
            mapped.setdefault("lng", lng)
            if not str(mapped.get("parcel_id") or "").strip():
                continue
            out.append(record_from_mapping(parish, parish_fips, mapped, extra={"raw": attrs}))
            if max_records and len(out) >= max_records:
                return out
        if not page.get("exceededTransferLimit") and len(features) < page_size:
            return out
        offset += len(features)
        if not features:
            return out


# ---------------------------------------------------------------------------
# Socrata (SODA 2.x) — e.g. data.nola.gov
# ---------------------------------------------------------------------------
def probe_socrata(
    domain: str, dataset_id: str, session: PoliteSession, aliases: dict | None = None
) -> BulkProbeResult:
    aliases = aliases or DEFAULT_FIELD_ALIASES
    url = f"https://{domain}/api/views/{dataset_id}.json"
    if not dataset_id:
        return BulkProbeResult(
            "socrata", url, False, "no dataset id configured (set ORLEANS_SOCRATA_DATASET_ID)"
        )
    try:
        meta = session.get_json(url, cache_key=f"probe/socrata_{dataset_id}")
    except Exception as e:  # noqa: BLE001
        return BulkProbeResult("socrata", url, False, f"metadata request failed: {e}")
    geo_types = {"point", "location", "multipolygon", "polygon", "line", "multiline", "multipoint"}
    cols = {
        c.get("fieldName", ""): c.get("fieldName", "")
        for c in meta.get("columns", [])
        if c.get("dataTypeName", "").lower() not in geo_types
    }
    field_map = map_aliases(cols, aliases)
    if not _mapping_ok(field_map):
        return BulkProbeResult(
            "socrata", url, False, f"columns not mappable ({sorted(cols)[:15]}...)", field_map
        )
    return BulkProbeResult("socrata", url, True, "ok", field_map, None)


def fetch_socrata(
    domain: str,
    dataset_id: str,
    session: PoliteSession,
    parish: str,
    parish_fips: str,
    field_map: dict,
    page_size: int = 5000,
    max_records: int | None = None,
) -> list[ParcelRecord]:
    out: list[ParcelRecord] = []
    offset = 0
    url = f"https://{domain}/resource/{dataset_id}.json"
    while True:
        rows = session.get_json(
            url, params={"$limit": page_size, "$offset": offset}, cache_key=f"{parish}/socrata_page_{offset}"
        )
        for row in rows:
            mapped = {target: row.get(src) for target, src in field_map.items()}
            loc = row.get("location") or row.get("the_geom") or row.get("geometry")
            if isinstance(loc, dict):
                coords = loc.get("coordinates")
                if loc.get("type") == "Point" and coords:
                    mapped.setdefault("lng", coords[0])
                    mapped.setdefault("lat", coords[1])
                elif "latitude" in loc:
                    mapped.setdefault("lat", loc.get("latitude"))
                    mapped.setdefault("lng", loc.get("longitude"))
            if not str(mapped.get("parcel_id") or "").strip():
                continue
            out.append(record_from_mapping(parish, parish_fips, mapped, extra={"raw": row}))
            if max_records and len(out) >= max_records:
                return out
        if len(rows) < page_size:
            return out
        offset += len(rows)


def probe_candidates(
    candidates: list[dict], session: PoliteSession, aliases: dict | None = None
) -> list[BulkProbeResult]:
    results = []
    for cand in candidates:
        if cand["kind"] == "arcgis":
            results.append(probe_arcgis(cand["url"], session, aliases))
        elif cand["kind"] == "socrata":
            results.append(probe_socrata(cand["domain"], cand.get("dataset_id", ""), session, aliases))
        else:
            results.append(BulkProbeResult(cand["kind"], str(cand), False, "unknown candidate kind"))
    return results
