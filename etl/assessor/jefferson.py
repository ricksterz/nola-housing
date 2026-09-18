"""Jefferson Parish Assessor (jpassessor.net) adapter — parcel, owner, assessed/market value, legal.

Bulk-first: the parish geoportal's parcel layer is probed before any page
pull. The search-UI parser maps the detail page's label/value pairs through
the aliases below; labels are matched case/punctuation-insensitively so minor
site wording changes do not break the mapping. URL paths and labels must be
confirmed against the live site on the first real run (see README).
"""

from .. import config
from .base import ParcelRecord, apply_sales_table, map_aliases, record_from_mapping
from .parse import find_labeled_table, parse_label_pairs, parse_table_rows

PARISH = "jefferson"
PARISH_FIPS = config.PARISH_FIPS[PARISH]

LABEL_ALIASES: dict[str, tuple[str, ...]] = {
    "parcel_id": ("Parcel Number", "Parcel No", "Parcel #", "Parcel ID", "Assessment Number", "Parcel"),
    "tax_bill_number": ("Tax Bill Number", "Tax Bill #", "Bill Number"),
    "site_address": ("Physical Address", "Property Address", "Site Address", "Location Address", "Location"),
    "city": ("City", "Municipality"),
    "zip_code": ("Zip", "Zip Code", "Postal Code"),
    "owner_name": ("Owner Name", "Owner", "Owner(s)", "Taxpayer Name"),
    "mailing_address": ("Mailing Address", "Owner Address", "Mail Address"),
    "legal_description": ("Legal Description", "Legal Desc", "Legal"),
    "subdivision": ("Subdivision", "Subdivision Name"),
    "property_class": ("Property Class", "Class", "Property Type", "Land Use"),
    "land_area": ("Lot Size", "Land Area", "Lot Sq Ft", "Square Footage of Land", "Acreage"),
    "building_area": ("Living Area", "Building Area", "Total Living Area", "Heated Area", "Square Feet"),
    "year_built": ("Year Built", "Yr Built", "Effective Year Built"),
    "land_val": ("Land Value", "Land Market Value", "Land"),
    "bld_val": ("Improvement Value", "Building Value", "Improvements", "Improvement Market Value"),
    "tot_mkt_val": ("Total Market Value", "Fair Market Value", "Market Value", "Total Value"),
    "assessed_val": ("Total Assessed Value", "Assessed Value", "Total Assessment", "Assessment"),
    "homestead_exempt_val": ("Homestead Exemption", "Homestead", "Exempt Value"),
    "taxable_val": ("Taxable Value", "Net Assessed Value", "Taxable Assessment"),
    "tax_year": ("Tax Year", "Roll Year", "Assessment Year", "Year"),
    "last_sale_date": ("Sale Date", "Last Sale Date", "Transfer Date"),
    "last_sale_price": ("Sale Price", "Last Sale Price", "Consideration"),
}


class JeffersonAdapter:
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
        mapped.setdefault("parcel_id", parcel_id)
        rows = parse_table_rows(html)
        value_history = find_labeled_table(rows, ("year", "assessed"))
        sales = find_labeled_table(rows, ("sale date", "price"))
        apply_sales_table(mapped, sales)
        return record_from_mapping(
            PARISH,
            PARISH_FIPS,
            mapped,
            extra={"value_history": value_history, "sales": sales, "labels": pairs},
        )
