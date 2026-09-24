"""Shared types for the assessor leg: one normalized parcel record per parish source."""

import re
from dataclasses import asdict, dataclass, field, fields
from typing import Any

# Column order of assessor_parcels_raw / assessor_parcels (excluding payload).
PARCEL_FIELDS = (
    "parish",
    "parish_fips",
    "parcel_id",
    "tax_bill_number",
    "site_address",
    "site_address_norm",
    "city",
    "zip_code",
    "owner_name",
    "mailing_address",
    "legal_description",
    "subdivision",
    "property_class",
    "land_area",
    "building_area",
    "year_built",
    "land_val",
    "bld_val",
    "tot_mkt_val",
    "assessed_val",
    "homestead_exempt_val",
    "taxable_val",
    "tax_year",
    "last_sale_date",
    "last_sale_price",
    "lat",
    "lng",
    # Appended (not inserted mid-tuple) so existing databases can add them with ALTER TABLE.
    "zoning",
    "last_sale_qualified",
)

_NUMERIC = {
    "land_area",
    "building_area",
    "land_val",
    "bld_val",
    "tot_mkt_val",
    "assessed_val",
    "homestead_exempt_val",
    "taxable_val",
    "last_sale_price",
    "lat",
    "lng",
}
_INTEGER = {"year_built", "tax_year"}


def normalize_address(addr: str | None) -> str | None:
    """Uppercase, collapse whitespace — same normalization the Houston comps app applies."""
    if not addr:
        return None
    return re.sub(r"\s+", " ", addr.strip().upper()) or None


def to_number(value: Any) -> float | None:
    """'$123,456.00' -> 123456.0; blanks/dashes -> None."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace("$", "").replace(",", "")
    if s in ("", "-", "—", "N/A", "n/a", "null", "None"):
        return None
    if s.startswith("(") and s.endswith(")"):
        s = "-" + s[1:-1]
    try:
        return float(s)
    except ValueError:
        m = re.search(r"-?\d+(?:\.\d+)?", s)
        return float(m.group(0)) if m else None


def to_int(value: Any) -> int | None:
    n = to_number(value)
    return int(n) if n is not None else None


def to_bool(value: Any) -> bool | None:
    """'True'/'Y'/1 -> True, 'False'/'N'/0 -> False, blank/unknown -> None (the PAO layer uses ' ')."""
    if value is None or isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    if s in ("true", "t", "yes", "y", "1"):
        return True
    if s in ("false", "f", "no", "n", "0"):
        return False
    return None


def to_zip(value: Any) -> str | None:
    if value is None:
        return None
    m = re.search(r"\b(\d{5})(?:-\d{4})?\b", str(value))
    return m.group(1) if m else None


def to_date(value: Any) -> str | None:
    """Best-effort ISO date from 'MM/DD/YYYY', 'YYYY-MM-DD', 'YYYYMMDD' or an epoch-ms int."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)) and value > 10_000_000_000:  # ArcGIS epoch millis
        from datetime import datetime, timezone

        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()
    s = str(value).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})", s)
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = re.match(r"^(\d{4})(\d{2})(\d{2})$", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


@dataclass
class ParcelRecord:
    parish: str
    parish_fips: str
    parcel_id: str
    tax_bill_number: str | None = None
    site_address: str | None = None
    site_address_norm: str | None = None
    city: str | None = None
    zip_code: str | None = None
    owner_name: str | None = None
    mailing_address: str | None = None
    legal_description: str | None = None
    subdivision: str | None = None
    property_class: str | None = None
    land_area: float | None = None
    building_area: float | None = None
    year_built: int | None = None
    land_val: float | None = None
    bld_val: float | None = None
    tot_mkt_val: float | None = None
    assessed_val: float | None = None
    homestead_exempt_val: float | None = None
    taxable_val: float | None = None
    tax_year: int | None = None
    last_sale_date: str | None = None
    last_sale_price: float | None = None
    lat: float | None = None
    lng: float | None = None
    zoning: str | None = None
    last_sale_qualified: bool | None = None
    extra: dict = field(default_factory=dict)

    def __post_init__(self):
        self.parcel_id = str(self.parcel_id).strip()
        if self.zoning is not None:
            self.zoning = str(self.zoning).strip() or None
        self.last_sale_qualified = to_bool(self.last_sale_qualified)
        if self.site_address_norm is None:
            self.site_address_norm = normalize_address(self.site_address)
        if self.zip_code:
            self.zip_code = to_zip(self.zip_code)
        for f in _NUMERIC:
            setattr(self, f, to_number(getattr(self, f)))
        for f in _INTEGER:
            setattr(self, f, to_int(getattr(self, f)))
        self.last_sale_date = to_date(self.last_sale_date)

    def as_row(self) -> tuple:
        return tuple(getattr(self, f) for f in PARCEL_FIELDS)

    def as_dict(self) -> dict:
        return asdict(self)


RECORD_FIELD_NAMES = {f.name for f in fields(ParcelRecord)}


def record_from_mapping(
    parish: str, parish_fips: str, mapped: dict, extra: dict | None = None
) -> ParcelRecord:
    """Build a ParcelRecord from a dict keyed by normalized field names; unknown keys go to extra."""
    known, leftovers = {}, {}
    for k, v in mapped.items():
        # Structured values (geometry dicts, lists) never land in a scalar field.
        if k in RECORD_FIELD_NAMES and k not in ("parish", "parish_fips") and not isinstance(v, (dict, list)):
            known[k] = v
        else:
            leftovers[k] = v
    if extra:
        leftovers.update(extra)
    if "parcel_id" not in known or known["parcel_id"] in (None, ""):
        raise ValueError("parcel_id is required")
    return ParcelRecord(parish=parish, parish_fips=parish_fips, extra=leftovers, **known)


def map_aliases(raw: dict, aliases: dict[str, tuple[str, ...]]) -> dict:
    """Map a raw {label: value} dict to normalized field names via per-field label aliases.

    Matching is case/punctuation-insensitive on the label. The first alias that
    matches wins, so list the most specific labels first.
    """

    def key(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", s.lower())

    by_key = {key(k): v for k, v in raw.items() if k is not None}
    out: dict = {}
    for target, labels in aliases.items():
        for label in labels:
            if key(label) in by_key and by_key[key(label)] not in (None, ""):
                out[target] = by_key[key(label)]
                break
    return out


def apply_sales_table(mapped: dict, sales: list[dict]) -> None:
    """Fill last_sale_date/price from the most recent sales-table row when no label pair supplied them."""
    if not sales:
        return
    first = sales[0]
    date_col = next((c for c in first if "date" in c.lower()), None)
    price_col = next(
        (c for c in first if any(k in c.lower() for k in ("price", "amount", "consideration"))), None
    )
    if date_col and "last_sale_date" not in mapped:
        mapped["last_sale_date"] = first[date_col]
    if price_col and "last_sale_price" not in mapped:
        mapped["last_sale_price"] = first[price_col]
