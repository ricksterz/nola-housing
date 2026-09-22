import { useState } from "react";
import { fmt, fmtCompactCurrency } from "../lib/theme";
import StatTile from "./StatTile";

const SCOPES = [
  { id: "22051", level: "county", label: "Metairie · Jefferson" },
  { id: "22071", level: "county", label: "New Orleans · Orleans" },
  { id: "35380", level: "metro", label: "Metro" },
];

export default function MacroStrip({ ctx }) {
  const { scorecard, macro } = ctx;
  const [scope, setScope] = useState("22071");
  const sc = SCOPES.find((s) => s.id === scope);
  const row = scorecard?.rows?.find((r) => r.geo_level === sc.level && r.geo_id === sc.id);
  const mortgage = macro?.mortgage_rate_30yr;
  const loading = !scorecard;

  const tiles = row
    ? [
        { label: "Median sale price", value: fmtCompactCurrency(row.median_sale_price), delta: row.price_yoy_pct, note: `Redfin · ${fmt.monthYear(row.price_month)}`, spark: row.spark_price, accent: true },
        { label: "Typical home value", value: fmtCompactCurrency(row.zhvi), delta: row.zhvi_yoy_pct, note: `Zillow ZHVI · ${fmt.monthYear(row.zhvi_month)}`, spark: row.spark_zhvi },
        { label: "Typical rent", value: row.zori != null ? `${fmt.currency(row.zori)}/mo` : "—", delta: row.zori_yoy_pct, note: row.zori_month ? `Zillow ZORI · ${fmt.monthYear(row.zori_month)}` : "not published" },
        { label: "Gross rent yield", value: fmt.pct(row.gross_yield_pct), note: "annual rent ÷ home value" },
        { label: "Homes sold", value: fmt.int(row.homes_sold), delta: row.sold_yoy_pct, note: "3-mo rolling window" },
        { label: "Median days on market", value: fmt.days(row.median_dom), delta: row.dom_yoy_delta != null ? (row.dom_yoy_delta / Math.max(1, row.median_dom - row.dom_yoy_delta)) * 100 : null, upIsGood: false },
        { label: "Active listings", value: fmt.int(row.active_listings), delta: row.active_yoy_pct, upIsGood: false, spark: row.spark_active },
        { label: "Months of supply", value: fmt.num(row.months_supply), note: "active ÷ monthly sales" },
        { label: "Sale $/sqft", value: row.price_psf != null ? `$${Math.round(row.price_psf)}` : "—", delta: row.psf_yoy_pct },
        { label: "Sale-to-list", value: fmt.pct(row.sale_to_list_ratio), note: `${fmt.pct(row.pct_price_drops, 0)} of listings cut price` },
      ]
    : [];

  return (
    <div className="panel">
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
        <div className="stat-label" style={{ marginBottom: 0 }}>{sc.label}</div>
        <div className="seg" role="group" aria-label="Area">
          {SCOPES.map((s) => (
            <button key={s.id} className={`seg-btn${scope === s.id ? " is-active" : ""}`} onClick={() => setScope(s.id)} aria-pressed={scope === s.id}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="stat-note" style={{ marginLeft: "auto" }}>
          30-yr mortgage:{" "}
          <b style={{ color: "var(--text-bright)" }}>{mortgage?.value != null ? `${mortgage.value}%` : "—"}</b>
          {mortgage?.date ? ` · Freddie Mac via FRED, ${mortgage.date}` : " · FRED refresh pending"}
        </div>
      </div>
      {loading && <div className="loading">Loading…</div>}
      {!loading && !row && <div className="empty">No market rows for this area yet.</div>}
      {row && (
        <div className="stat-grid">
          {tiles.map((t) => (
            <StatTile key={t.label} {...t} />
          ))}
        </div>
      )}
    </div>
  );
}
