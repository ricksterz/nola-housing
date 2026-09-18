from etl.assessor import JeffersonAdapter, OrleansAdapter
from etl.assessor.base import ParcelRecord, map_aliases, normalize_address, to_date, to_number, to_zip
from etl.assessor.parse import find_labeled_table, parse_label_pairs, parse_table_rows


def test_converters():
    assert to_number("$1,234.50") == 1234.5
    assert to_number("(500)") == -500.0
    assert to_number("—") is None
    assert to_number("2,150 sq ft") == 2150.0
    assert to_zip("70005-1234") == "70005"
    assert to_zip("Metairie, LA 70005") == "70005"
    assert to_date("06/15/2019") == "2019-06-15"
    assert to_date("2019-06-15T00:00:00") == "2019-06-15"
    assert to_date(1560556800000) == "2019-06-15"
    assert normalize_address("  123   Metairie  Rd ") == "123 METAIRIE RD"


def test_parcel_record_normalizes():
    r = ParcelRecord(
        "jefferson",
        "22051",
        " 0520001234 ",
        site_address="123  Metairie Rd",
        zip_code="70005-1234",
        assessed_val="$57,500",
        year_built="1948",
        last_sale_date="06/15/2019",
    )
    assert r.parcel_id == "0520001234"
    assert r.site_address_norm == "123 METAIRIE RD"
    assert r.zip_code == "70005"
    assert r.assessed_val == 57500.0
    assert r.year_built == 1948
    assert r.last_sale_date == "2019-06-15"
    assert len(r.as_row()) == 27


def test_parse_label_pairs_ignores_scripts_and_handles_4col_rows(fx):
    html = (fx / "assessor" / "jefferson_detail.html").read_text()
    pairs = parse_label_pairs(html)
    assert pairs["Owner Name"] == "DOE, JANE & JOHN"  # not the script decoy
    assert pairs["Tax Year"] == "2026"
    assert pairs["Land Value"] == "$150,000"  # from <dl>
    assert pairs["Mailing Address"] == "123 METAIRIE RD METAIRIE, LA 70005"
    rows = parse_table_rows(html)
    hist = find_labeled_table(rows, ("year", "assessed"))
    assert [h["Year"] for h in hist] == ["2026", "2025", "2024"]
    assert hist[1]["Assessed Value"] == "$55,000"


def test_map_aliases_is_case_and_punctuation_insensitive():
    out = map_aliases(
        {"OWNER NAME:": "X", "total assessed value": "1"},
        {"owner_name": ("Owner Name",), "assessed_val": ("Total Assessed Value",)},
    )
    assert out == {"owner_name": "X", "assessed_val": "1"}


def test_jefferson_adapter(fx):
    rec = JeffersonAdapter().parse_detail(
        (fx / "assessor" / "jefferson_detail.html").read_text(), "0520001234"
    )
    assert rec.parish == "jefferson" and rec.parish_fips == "22051"
    assert rec.parcel_id == "0520001234"
    assert rec.owner_name == "DOE, JANE & JOHN"
    assert rec.site_address == "123 Metairie Rd"
    assert rec.site_address_norm == "123 METAIRIE RD"
    assert rec.zip_code == "70005"
    assert rec.legal_description == "LOT 4 SQ 12 OLD METAIRIE PLACE 60X120"
    assert rec.land_val == 150000 and rec.bld_val == 425000
    assert rec.tot_mkt_val == 575000 and rec.assessed_val == 57500
    assert rec.homestead_exempt_val == 7500 and rec.taxable_val == 50000
    assert rec.building_area == 2150 and rec.land_area == 7200 and rec.year_built == 1948
    assert rec.tax_year == 2026
    assert rec.last_sale_date == "2019-06-15" and rec.last_sale_price == 489000
    assert len(rec.extra["value_history"]) == 3
    assert rec.extra["sales"][0]["Price"] == "$489,000"


def test_jefferson_adapter_not_found(fx):
    assert JeffersonAdapter().parse_detail((fx / "assessor" / "not_found.html").read_text(), "1") is None


def test_orleans_adapter_uses_tax_bill_as_parcel_id(fx):
    rec = OrleansAdapter().parse_detail((fx / "assessor" / "orleans_detail.html").read_text(), "512345678")
    assert rec.parish_fips == "22071"
    assert rec.tax_bill_number == "512345678"
    assert rec.parcel_id == "512345678"
    assert rec.owner_name == "ROE, RICHARD"
    assert rec.site_address_norm == "1234 MAGAZINE ST"
    assert rec.assessed_val == 40500 and rec.tot_mkt_val == 405000
    assert rec.zip_code == "70130"
    assert [h["Year"] for h in rec.extra["value_history"]] == ["2026", "2025"]


def test_detail_url_templates():
    assert "0520001234" in JeffersonAdapter().detail_url("0520001234")
    assert OrleansAdapter("https://x/{parcel_id}").detail_url("9") == "https://x/9"
