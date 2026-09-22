import { useEffect, useRef, useState } from "react";
import { Line, LineChart } from "recharts";
import { getPropertyLookup, getTrend, suggestAddresses } from "../api";
import ChartPanel from "../components/ChartPanel";
import Table from "../components/Table";
import { Frame, currencyAxis, lineProps } from "../components/charts";
import { monthLabel } from "../lib/rangeUtils";
import { fmt, fmtCompactCurrency, seriesColor } from "../lib/theme";

const SUGGEST_DEBOUNCE_MS = 150;

export default function Property({ ctx }) {
  const { meta, theme, navigate, url } = ctx;
  const [address, setAddress] = useState(url.q || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [trend, setTrend] = useState(null);
  const count = meta?.property_count ?? null;
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    if (url.q) search(url.q);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const zip = data?.parcel?.zip_code;
    if (!zip) return;
    getTrend("zip", zip).then((t) => setTrend(t.series)).catch(() => setTrend(null));
  }, [data]);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function search(addr = address) {
    if (!addr.trim()) return;
    setSuggestOpen(false);
    setLoading(true);
    setError(null);
    setData(null);
    setTrend(null);
    getPropertyLookup(addr)
      .then((d) => {
        setData(d);
        // Show the full "street, city, LA zip" once we know it — the search key stays the
        // plain street address (getPropertyLookup strips anything after the first comma).
        const full = d.parcel.full_address || addr;
        setAddress(full);
        navigate({ q: full }, { replace: true });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function onInput(v) {
    setAddress(v);
    setActiveIndex(-1);
    clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const seq = ++requestSeq.current;
    debounceRef.current = setTimeout(async () => {
      const results = await suggestAddresses(v).catch(() => []);
      if (seq !== requestSeq.current) return; // a newer keystroke superseded this request
      setSuggestions(results);
      setSuggestOpen(results.length > 0);
    }, SUGGEST_DEBOUNCE_MS);
  }

  function pick(a) {
    setAddress(a.full);
    setSuggestOpen(false);
    search(a.address);
  }

  function onKeyDown(e) {
    if (suggestOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === "Escape") {
        setSuggestOpen(false);
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        pick(suggestions[activeIndex]);
        return;
      }
    }
    if (e.key === "Enter") search();
  }

  return (
    <div>
      {count === 0 && (
        <div className="empty" style={{ marginBottom: 16 }}>
          <b>Parcel records are not loaded yet.</b> The assessor leg pulls Jefferson Parish and Orleans Parish
          records on the parishes' own calendars — Orleans during its Jul 15 – Aug 15 open-rolls window and
          Jefferson after the Aug 15 – Sep 15 inspection period — probing each parish's official bulk data first
          and only then batch-pulling the public search sites under a strict rate limit. Once a pull has run,
          search any street address here for owner, assessed and market value, value history and the ZIP's
          market context.
        </div>
      )}
      {count > 0 && (
        <div className="num" style={{ fontSize: 12, color: "var(--text-dimmer)", marginBottom: 10 }}>
          {count.toLocaleString()} parcels available
        </div>
      )}

      <div className="search-row" ref={boxRef}>
        <input
          className="search-input"
          value={address}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Street address, e.g. 123 METAIRIE RD"
          aria-label="Street address"
          role="combobox"
          aria-expanded={suggestOpen}
          aria-controls="address-suggestions"
          aria-activedescendant={activeIndex >= 0 ? `address-suggestion-${activeIndex}` : undefined}
          autoComplete="off"
        />
        {suggestOpen && (
          <div className="suggestions" id="address-suggestions" role="listbox">
            {suggestions.map((a, i) => (
              <div
                key={a.address}
                id={`address-suggestion-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`suggestion${i === activeIndex ? " suggestion--active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              >
                {highlightMatch(a.full, address)}
              </div>
            ))}
          </div>
        )}
        <button className="btn-primary" onClick={() => search()} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {data && <ParcelCard data={data} trend={trend} theme={theme} />}
    </div>
  );
}

function highlightMatch(text, query) {
  const needle = query.trim();
  if (!needle) return text;
  const i = text.toUpperCase().indexOf(needle.toUpperCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <b>{text.slice(i, i + needle.length)}</b>
      {text.slice(i + needle.length)}
    </>
  );
}

// Every stat is { label, value } with value already null when there's nothing to show — a
// section renders only if at least one of its stats survived, so the card never shows a wall
// of "—" placeholders for fields this data source simply doesn't carry (Jefferson's assessor
// feed has no year built, living area or sale history, for instance).
function ParcelCard({ data, trend, theme }) {
  const p = data.parcel;
  const v = data.valuation;
  const address = p.full_address || p.site_address || p.site_address_norm;

  const sections = [
    [
      "Valuation",
      [
        { label: "Assessor market value", value: p.tot_mkt_val ? fmt.currency(p.tot_mkt_val) : null },
        { label: "Assessed value", value: p.assessed_val != null ? fmt.currency(p.assessed_val) : null },
        { label: "Land value", value: p.land_val != null ? fmt.currency(p.land_val) : null },
        { label: "Building value", value: p.bld_val != null ? fmt.currency(p.bld_val) : null },
        { label: "Homestead exemption", value: p.homestead_exempt_val ? fmt.currency(p.homestead_exempt_val) : null },
        { label: "Taxable value", value: p.taxable_val != null ? fmt.currency(p.taxable_val) : null },
      ],
    ],
    [
      "Property",
      [
        { label: "Year built", value: p.year_built ? fmt.raw(p.year_built) : null },
        { label: "Living area", value: p.building_area ? `${fmt.int(p.building_area)} sq ft` : null },
        { label: "Lot", value: p.land_area ? `${fmt.int(p.land_area)} sq ft` : null },
        { label: "Property class", value: p.property_class || null },
        { label: "Subdivision", value: p.subdivision || null },
      ],
    ],
    [
      "Ownership",
      [
        { label: "Owner", value: p.owner_name ? fmt.raw(p.owner_name) : null },
        { label: "Last sale", value: p.last_sale_date ? `${fmt.date(p.last_sale_date)} · ${fmt.currency(p.last_sale_price)}` : null },
        { label: "Tax bill #", value: p.tax_bill_number || null },
      ],
    ],
    [
      "ZIP market context",
      [
        { label: "Median home value", value: p.zhvi ? fmtCompactCurrency(p.zhvi) : null },
        { label: "Median sale price", value: p.redfin_median_sale_price ? fmtCompactCurrency(p.redfin_median_sale_price) : null },
      ],
    ],
  ]
    .map(([title, items]) => [title, items.filter((s) => s.value)])
    .filter(([, items]) => items.length > 0);

  const history = (data.value_history || []).map((h) => ({ ...h, monthLabel: String(h.tax_year) }));
  const implied = trend && v ? trend.filter((d) => d.zhvi != null).map((d, _, arr) => ({ monthLabel: monthLabel(d.month), month: d.month, implied: Math.round((d.zhvi / arr[arr.length - 1].zhvi) * v.est_mid) })) : [];

  return (
    <>
      <div className="panel">
        <div className="parcel-header">
          <div>
            <div className="parcel-address">{address}</div>
            <div className="parcel-sub">
              {p.parish === "jefferson" ? "Jefferson Parish" : "Orleans Parish"} · Parcel {p.parcel_id}
            </div>
          </div>
          {p.lat && p.lng && (
            <a
              className="btn"
              href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              View on map ↗
            </a>
          )}
        </div>
        {sections.map(([title, items]) => (
          <div key={title} className="stat-section">
            <div className="stat-section-title">{title}</div>
            <div className="stat-grid">
              {items.map((s) => (
                <div key={s.label} className="stat">
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value">{s.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {p.legal_description && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-alt)", color: "var(--text-dimmer)", fontSize: 12 }}>
            Legal: {p.legal_description}
          </div>
        )}
      </div>

      {v && (
        <div className="panel panel--gold">
          <h3 className="panel-title panel-title--gold">Indicative market value</h3>
          <div className="range-stats">
            <div><div className="stat-label">Low</div><div className="range-stat-value">{fmt.currency(v.est_low)}</div></div>
            <div><div className="stat-label">Mid</div><div className="range-stat-value range-stat-value--mid">{fmt.currency(v.est_mid)}</div></div>
            <div><div className="stat-label">High</div><div className="range-stat-value">{fmt.currency(v.est_high)}</div></div>
            {p.tot_mkt_val && <div><div className="stat-label">Assessor market value</div><div className="range-stat-value range-stat-value--ref">{fmt.currency(p.tot_mkt_val)}</div></div>}
          </div>
          <div className="method-note">
            {fmt.int(v.sqft_used)} sq ft × the ZIP's Redfin median sale price per square foot over the last {v.months_used} months
            (25th / 50th / 75th percentile ≈ ${v.ppsf_low} / ${v.ppsf_mid} / ${v.ppsf_high} per sq ft, as of {fmt.monthYear(v.as_of)}).
            A market-level indicator scaled to this home's size — not a professional appraisal; condition, lot and renovations are not considered.
          </div>
        </div>
      )}

      {history.length > 1 && (
        <ChartPanel title="Assessed value history" subtitle="From the assessor's roll, by tax year" rows={history} columns={[{ key: "tax_year", label: "Tax year" }, { key: "tot_mkt_val", label: "Market", type: "currency" }, { key: "assessed_val", label: "Assessed", type: "currency" }]} height={200}>
          <LineChart data={history}>
            <Frame yFormat="currency" yAxis={currencyAxis} series={2} />
            <Line {...lineProps} dataKey="tot_mkt_val" name="Market value" stroke={seriesColor(0, theme)} />
            <Line {...lineProps} dataKey="assessed_val" name="Assessed value" stroke={seriesColor(1, theme)} />
          </LineChart>
        </ChartPanel>
      )}
      {history.length === 1 && (
        <div className="panel">
          <h3 className="panel-title">Assessed value history</h3>
          <Table columns={[{ key: "tax_year", label: "Tax year" }, { key: "land_val", label: "Land", type: "currency" }, { key: "bld_val", label: "Building", type: "currency" }, { key: "tot_mkt_val", label: "Market", type: "currency" }, { key: "assessed_val", label: "Assessed", type: "currency" }]} rows={history} />
        </div>
      )}

      {implied.length > 0 && (
        <ChartPanel title="Implied value history" subtitle="Mid estimate scaled by the ZIP's Zillow home value index" rows={implied} columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "implied", label: "Implied", type: "currency" }]} height={200}>
          <LineChart data={implied}>
            <Frame yFormat="currency" yAxis={currencyAxis} series={1} />
            <Line {...lineProps} dataKey="implied" name="Implied value" stroke={seriesColor(0, theme)} />
          </LineChart>
        </ChartPanel>
      )}
    </>
  );
}
