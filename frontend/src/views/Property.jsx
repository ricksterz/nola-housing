import { useEffect, useState } from "react";
import { Line, LineChart } from "recharts";
import { getPropertyLookup, getTrend, suggestAddresses } from "../api";
import ChartPanel from "../components/ChartPanel";
import Table from "../components/Table";
import { Frame, currencyAxis, lineProps } from "../components/charts";
import { monthLabel } from "../lib/rangeUtils";
import { fmt, fmtCompactCurrency, seriesColor } from "../lib/theme";

export default function Property({ ctx }) {
  const { meta, theme, navigate, url } = ctx;
  const [address, setAddress] = useState(url.q || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [trend, setTrend] = useState(null);
  const count = meta?.property_count ?? null;

  useEffect(() => {
    if (url.q) search(url.q);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const zip = data?.parcel?.zip_code;
    if (!zip) return;
    getTrend("zip", zip).then((t) => setTrend(t.series)).catch(() => setTrend(null));
  }, [data]);

  function search(addr = address) {
    if (!addr.trim()) return;
    setSuggestions([]);
    setLoading(true);
    setError(null);
    setData(null);
    setTrend(null);
    getPropertyLookup(addr)
      .then((d) => {
        setData(d);
        navigate({ q: addr }, { replace: true });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  async function onInput(v) {
    setAddress(v);
    setSuggestions(await suggestAddresses(v).catch(() => []));
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

      <div className="search-row">
        <input
          className="search-input"
          value={address}
          onChange={(e) => onInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && search()}
          placeholder="Street address, e.g. 123 METAIRIE RD"
          aria-label="Street address"
        />
        {suggestions.length > 0 && (
          <div className="suggestions" role="listbox">
            {suggestions.map((a) => (
              <div key={a} role="option" className="suggestion" onMouseDown={() => { setAddress(a); search(a); }}>
                {a}
              </div>
            ))}
          </div>
        )}
        <button className="btn-primary" onClick={() => search()} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <div className="error">Error: {error}</div>}

      {data && <ParcelCard data={data} trend={trend} theme={theme} />}
    </div>
  );
}

function ParcelCard({ data, trend, theme }) {
  const p = data.parcel;
  const v = data.valuation;
  const stats = [
    { label: "Address", value: p.site_address || p.site_address_norm },
    { label: "Parish", value: p.parish === "jefferson" ? "Jefferson" : "Orleans" },
    v && { label: "Indicative value", value: `${fmtCompactCurrency(v.est_low)} – ${fmtCompactCurrency(v.est_high)}`, accent: true },
    { label: "Assessor market value", value: fmt.currency(p.tot_mkt_val) },
    { label: "Assessed value", value: fmt.currency(p.assessed_val) },
    { label: "Land value", value: fmt.currency(p.land_val) },
    { label: "Building value", value: fmt.currency(p.bld_val) },
    { label: "Homestead exemption", value: fmt.currency(p.homestead_exempt_val) },
    { label: "Taxable value", value: fmt.currency(p.taxable_val) },
    { label: "Year built", value: fmt.raw(p.year_built) },
    { label: "Living area", value: p.building_area ? `${fmt.int(p.building_area)} sq ft` : "—" },
    { label: "Lot", value: p.land_area ? `${fmt.int(p.land_area)} sq ft` : "—" },
    { label: "Last sale", value: p.last_sale_date ? `${fmt.date(p.last_sale_date)} · ${fmt.currency(p.last_sale_price)}` : "—" },
    { label: "Owner", value: fmt.raw(p.owner_name) },
    { label: "Tax bill #", value: fmt.raw(p.tax_bill_number) },
    { label: "Parcel ID", value: p.parcel_id },
    { label: "ZIP market", value: p.zhvi ? `ZHVI ${fmtCompactCurrency(p.zhvi)} · median sale ${fmtCompactCurrency(p.redfin_median_sale_price)}` : "—" },
  ].filter(Boolean);

  const history = (data.value_history || []).map((h) => ({ ...h, monthLabel: String(h.tax_year) }));
  const implied = trend && v ? trend.filter((d) => d.zhvi != null).map((d, _, arr) => ({ monthLabel: monthLabel(d.month), month: d.month, implied: Math.round((d.zhvi / arr[arr.length - 1].zhvi) * v.est_mid) })) : [];

  return (
    <>
      <div className="panel">
        <div className="stat-grid">
          {stats.map((s) => (
            <div key={s.label} className="stat">
              <div className="stat-label">{s.label}</div>
              <div className={`stat-value${s.accent ? " stat-value--accent" : ""}`}>{s.value}</div>
            </div>
          ))}
        </div>
        {p.legal_description && (
          <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px solid var(--border-alt)", color: "var(--text-dimmer)", fontSize: 12 }}>
            Legal: {p.legal_description}
          </div>
        )}
        {p.lat && p.lng && (
          <div style={{ marginTop: 8, fontSize: 12 }}>
            <a href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`} target="_blank" rel="noreferrer">
              View on map ↗
            </a>
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
