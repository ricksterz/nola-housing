"""Orleans Parish Assessor (nolaassessor.com) adapter — parcel, owner, assessed value, tax bill number.

Orleans identifies parcels primarily by tax bill number; the assessor's own
parcel/GEOPIN is carried when present. Bulk-first: the city's open-data portal
(data.nola.gov) and NOLA GIS parcel layer are probed before any page pull.
URL paths, dataset IDs and labels must be confirmed against the live site on
the first real run (see README).
"""

from .. import config
from .base import ParcelRecord, apply_sales_table, map_aliases, record_from_mapping
from .parse import find_labeled_table, parse_label_pairs, parse_table_rows

PARISH = "orleans"
PARISH_FIPS = config.PARISH_FIPS[PARISH]

LABEL_ALIASES: dict[str, tuple[str, ...]] = {
    "tax_bill_number": ("Tax Bill Number", "Tax Bill No", "Tax Bill #", "Tax Bill", "Bill Number"),
    "parcel_id": ("Parcel Number", "Parcel ID", "GEOPIN", "Parcel", "Property ID"),
    "site_address": ("Location Address", "Property Location", "Property Address", "Location", "Site Address"),
    "city": ("City",),
    "zip_code": ("Zip", "Zip Code"),
    "owner_name": ("Owner Name", "Owner", "Owner(s)"),
    "mailing_address": ("Mailing Address", "Owner Address"),
    "legal_description": ("Legal Description", "Legal"),
    "subdivision": ("Subdivision", "Municipal District"),
    "property_class": ("Property Class", "Land Class", "Class", "Property Type"),
    "land_area": ("Lot Size", "Land Area", "Square Footage", "Lot Sq Ft"),
    "building_area": ("Building Area", "Living Area", "Total Living Area", "Improvement Area"),
    "year_built": ("Year Built",),
    "land_val": ("Land Value", "Land"),
    "bld_val": ("Building Value", "Improvement Value", "Improvements", "Building"),
    "tot_mkt_val": ("Total Value", "Total Market Value", "Market Value", "Fair Market Value"),
    "assessed_val": (
        "Assessed Value",
        "Total Assessed Value",
        "Assessed Land Value + Building",
        "Assessment",
    ),
    "homestead_exempt_val": ("Homestead Exemption", "Homestead", "Exemption"),
    "taxable_val": ("Taxable Assessment", "Taxable Value", "Net Assessed"),
    "tax_year": ("Tax Year", "Roll Year", "Year"),
    "last_sale_date": ("Sale Date", "Last Sale Date", "Transfer Date", "Date of Sale"),
    "last_sale_price": ("Sale Price", "Last Sale Price", "Price", "Sale Amount"),
}


class OrleansAdapter:
    parish = PARISH
    parish_fips = PARISH_FIPS

    def __init__(self, detail_template: str | None = None):
        self.detail_template = detail_template or config.ASSESSOR_SOURCES[PARISH]["search_ui"]["detail_url"]

    def detail_url(self, parcel_id: str) -> str:
        return self.detail_template.format(parcel_id=parcel_id)

    def parse_detail(self, html: str, parcel_id: str) -> ParcelRecord | None:
        pairs = parse_label_pairs(html)
        mapped = map_aliases(pairs, LABEL_ALIASES)
        if not mapped or not any(k in mapped for k in ("owner_name", "assessed_val", "site_address")):
            return None
        # Orleans parcels are keyed by tax bill number; use it as the parcel_id
        # when the page exposes no separate parcel/GEOPIN.
        mapped.setdefault("tax_bill_number", parcel_id)
        mapped.setdefault("parcel_id", mapped.get("tax_bill_number") or parcel_id)
        rows = parse_table_rows(html)
        value_history = find_labeled_table(rows, ("year", "assess"))
        sales = find_labeled_table(rows, ("sale", "price"))
        apply_sales_table(mapped, sales)
        return record_from_mapping(
            PARISH,
            PARISH_FIPS,
            mapped,
            extra={"value_history": value_history, "sales": sales, "labels": pairs},
        )
