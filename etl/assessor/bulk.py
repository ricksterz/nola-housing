"""Official bulk-data probes: ArcGIS REST parcel layers and Socrata (data.nola.gov) datasets.

Both are checked before any search-UI scraping. A candidate "works" when it
answers with layer/dataset metadata whose fields can be mapped to at least a
parcel ID and one of (owner, assessed value, address). Records are fetched with
pagination and returned as ParcelRecords with WGS84 centroids where geometry is
available.
"""

import logging
import re
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
    # Jefferson splits a co-owned record across two fields: OWNERNAME ends in "&" ("DETIEGE,WILLIE
    # JR &") and the co-owner begins the next line, run into the mailing street ("LEONORIA S
    # DETIEGE 1506 AMES BLVD"). Only the name is kept (join_co_owner); the address is never stored.
    "co_owner_line": ("OWNER_ADDR",),
    # data.nola.gov Parcels splits the site address into parts; assemble_situs joins them.
    "situs_number": ("SITUS_NUMBER",),
    "situs_dir": ("SITUS_DIR",),
    "situs_street": ("SITUS_STREET",),
    "situs_type": ("SITUS_TYPE",),
    # Orleans (City ParcelSearch) carries a second owner in its own field; it's joined on with "&".
    "owner_name_2": ("OWNERNME2", "OWNER2", "OWNER_NAME_2"),
    "mailing_address": ("MAIL_ADDR", "MAILING_ADDRESS", "OWNER_ADDRESS", "MAILADDRESS"),
    "legal_description": ("LEGAL", "LEGAL_DESC", "LEGAL_DESCRIPTION", "LGL_DESC"),
    "subdivision": ("SUBDIVISION", "SUBDIV", "SUBDIVISION_NAME", "PARCELSUBD"),
    "property_class": ("PROP_CLASS", "PROPERTY_CLASS", "CLASS", "LAND_USE", "USE_CODE", "PROPERTY_TYPE"),
    # Square feet only. Shape-area fields are left out: their units follow each server's map
    # projection (Orleans ParcelSearch reports ~1,135 for a 9,140 sq ft lot).
    "land_area": ("LAND_AREA", "LOT_SQFT", "SQ_FT_LAND", "LAND_SQFT"),
    "land_acres": ("ACRES",),  # converted to land_area by lot_area_from_acres
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

# Where the mailing address starts in the co-owner line: a house number or a PO box.
_ADDRESS_START = re.compile(r"\s(?:\d|P\.?\s*O\.?\s*BOX\b)", re.IGNORECASE)


def split_site_address(address: str | None) -> tuple[str | None, str | None]:
    """ "624 S ALEXANDER ST, LA, 70119" -> ("624 S ALEXANDER ST", "70119"). Orleans' ParcelSearch
    runs state and ZIP into the site address; an address with no comma is returned as is."""
    if not isinstance(address, str) or "," not in address:
        return address, None
    street = address.split(",")[0].strip()
    m = re.search(r"\b(\d{5})(?:-\d{4})?\s*$", address)
    return street or None, m.group(1) if m else None


def join_co_owner(owner: str | None, line: str | None) -> str | None:
    """ "SMUCK,STEVEN M &" + "JANE D SMUCK 321 BONNABEL BLVD" -> "SMUCK,STEVEN M & JANE D SMUCK"."""
    owner = (owner or "").strip()
    if not owner.endswith("&") or not (line or "").strip():
        return owner or None
    padded = " " + line.strip()
    m = _ADDRESS_START.search(padded)
    co = (padded[: m.start()] if m else padded).strip()
    if not co or co.upper().startswith("C/O"):  # no name before the address, or a care-of line
        return owner
    return f"{owner} {co}"


@dataclass
class BulkProbeResult:
    kind: str
    url: str
    ok: bool
    reason: str
    field_map: dict | None = None
    record_count: int | None = None


def _mapping_ok(field_map: dict) -> bool:
    has_address = "site_address" in field_map or "situs_street" in field_map
    return "parcel_id" in field_map and (has_address or any(k in field_map for k in REQUIRED_ANY))


_SITUS_PARTS = ("situs_number", "situs_dir", "situs_street", "situs_type")


def lot_area_from_acres(mapped: dict) -> None:
    """Fill land_area (sq ft) from an acreage field, in place."""
    acres = mapped.pop("land_acres", None)
    try:
        acres = float(acres)
    except (TypeError, ValueError):
        return
    if acres > 0 and not mapped.get("land_area"):
        mapped["land_area"] = round(acres * 43_560)


def assemble_situs(mapped: dict) -> None:
    """Join split site-address parts ("2511", "", "EAGLE", "ST") into site_address, in place."""
    parts = [str(mapped.pop(k) or "").strip() for k in _SITUS_PARTS if k in mapped]
    if not mapped.get("site_address") and len(parts) == len(_SITUS_PARTS) and parts[0] and parts[2]:
        mapped["site_address"] = " ".join(p for p in parts if p)


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


class ArcgisQueryFailed(RuntimeError):
    """A query page still failed after its retries."""


ARCGIS_PAGE_RETRIES = 5
ARCGIS_RETRY_SECONDS = 30.0


def _arcgis_page(session: PoliteSession, url: str, params: dict, cache_key: str) -> dict:
    """One query page. ArcGIS reports a failed query as HTTP 200 with an "error" body, so those are
    retried with a growing wait and then raised: a bad page must never read as the end of the
    layer, or a refresh would replace a whole parish with the pages before it."""
    delay = ARCGIS_RETRY_SECONDS
    for attempt in range(ARCGIS_PAGE_RETRIES + 1):
        page = session.get_json(url, params=params, cache_key=cache_key)
        if not isinstance(page, dict) or "error" not in page:
            return page
        if attempt == ARCGIS_PAGE_RETRIES:
            raise ArcgisQueryFailed(f"{url} at offset {params.get('resultOffset')}: {page['error']}")
        log.warning(
            "ArcGIS query failed at offset %s (%s); retrying in %.0fs",
            params.get("resultOffset"),
            page["error"],
            delay,
        )
        session._sleep(delay)
        delay *= 2
    raise RuntimeError("unreachable")


def fetch_arcgis(
    url: str,
    session: PoliteSession,
    parish: str,
    parish_fips: str,
    field_map: dict,
    page_size: int = 1000,
    where: str = "1=1",
    max_records: int | None = None,
    stats: dict | None = None,
    out_fields: str | None = None,
) -> list[ParcelRecord]:
    """Page through an ArcGIS layer; returns ParcelRecords with WGS84 centroid lat/lng.
    ``out_fields`` overrides the requested field list (e.g. "*" for a layer that rejects named
    fields); stored raw attributes are still limited to the mapped fields.

    ``stats["features"]`` is set to the number of features read, including ones skipped for
    having no parcel ID, so callers can check the pull against the layer's record count."""
    out: list[ParcelRecord] = []
    offset = 0
    seen = 0
    wanted = set(field_map.values())
    out_fields = out_fields or ",".join(sorted(wanted))
    while True:
        page = _arcgis_page(
            session,
            url.rstrip("/") + "/query",
            {
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
        seen += len(features)
        if stats is not None:
            stats["features"] = seen
        for feat in features:
            attrs = {k: v for k, v in feat.get("attributes", {}).items() if k in wanted}
            mapped = {target: attrs.get(src) for target, src in field_map.items()}
            if "co_owner_line" in field_map:
                mapped["owner_name"] = join_co_owner(mapped.get("owner_name"), mapped.pop("co_owner_line"))
                attrs = {k: v for k, v in attrs.items() if k != field_map["co_owner_line"]}
            second = mapped.pop("owner_name_2", None)
            if isinstance(second, str) and second.strip():
                first = (mapped.get("owner_name") or "").strip()
                mapped["owner_name"] = f"{first} & {second.strip()}" if first else second.strip()
            lot_area_from_acres(mapped)
            street, zip_code = split_site_address(mapped.get("site_address"))
            mapped["site_address"] = street
            if zip_code and not str(mapped.get("zip_code") or "").strip():
                mapped["zip_code"] = zip_code
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
def _geojson_centroid(geom) -> tuple[float | None, float | None]:
    """Vertex average of a GeoJSON Point/Polygon/MultiPolygon, as (lat, lng)."""
    if not isinstance(geom, dict) or not geom.get("coordinates"):
        return None, None
    coords, kind = geom["coordinates"], geom.get("type")
    if kind == "Point":
        return coords[1], coords[0]
    polygons = coords if kind == "MultiPolygon" else [coords] if kind == "Polygon" else []
    pts = []
    for poly in polygons:
        for ring in poly[:1]:  # outer ring only
            pts.extend(ring[:-1] if len(ring) > 1 and ring[0] == ring[-1] else ring)
    if not pts:
        return None, None
    return sum(p[1] for p in pts) / len(pts), sum(p[0] for p in pts) / len(pts)


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
    count = None
    try:
        rows = session.get_json(
            f"https://{domain}/resource/{dataset_id}.json", params={"$select": "count(*)"}
        )
        count = int(next(iter(rows[0].values())))
    except Exception as e:  # noqa: BLE001
        log.info("socrata count query failed for %s: %s", dataset_id, e)
    return BulkProbeResult("socrata", url, True, "ok", field_map, count)


def fetch_socrata(
    domain: str,
    dataset_id: str,
    session: PoliteSession,
    parish: str,
    parish_fips: str,
    field_map: dict,
    page_size: int = 5000,
    max_records: int | None = None,
    stats: dict | None = None,
) -> list[ParcelRecord]:
    """Page through a Socrata dataset (ordered by row id, so pages never shift under us).
    ``stats["features"]`` counts rows read, as in fetch_arcgis."""
    out: list[ParcelRecord] = []
    offset = 0
    url = f"https://{domain}/resource/{dataset_id}.json"
    geo_keys = ("location", "the_geom", "geometry")
    while True:
        rows = session.get_json(
            url,
            params={"$limit": page_size, "$offset": offset, "$order": ":id"},
            cache_key=f"{parish}/socrata_page_{offset}",
        )
        if stats is not None:
            stats["features"] = offset + len(rows)
        for row in rows:
            mapped = {target: row.get(src) for target, src in field_map.items()}
            assemble_situs(mapped)
            lot_area_from_acres(mapped)
            loc = next((row[k] for k in geo_keys if isinstance(row.get(k), dict)), None)
            if loc is not None and "latitude" in loc:
                mapped.setdefault("lat", float(loc["latitude"]))
                mapped.setdefault("lng", float(loc["longitude"]))
            else:
                lat, lng = _geojson_centroid(loc)
                mapped.setdefault("lat", lat)
                mapped.setdefault("lng", lng)
            if not str(mapped.get("parcel_id") or "").strip():
                continue
            # Keep the row's attributes, not its polygon: the lot center is all the join needs.
            raw = {k: v for k, v in row.items() if k not in geo_keys}
            out.append(record_from_mapping(parish, parish_fips, mapped, extra={"raw": raw}))
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
