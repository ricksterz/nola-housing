import { useEffect, useMemo, useState } from "react";
import { getOwnershipCosts } from "../api";
import { CostInputs, CostLegend, StackedCostBar } from "../components/MonthlyCost";
import Sparkline from "../components/Sparkline";
import { COST_PARTS, HOMEOWNERS_RANGE, annualTax, monthlyCost, useCostAssumptions } from "../lib/costs";
import { diverging, fmt, fmtCompactCurrency, readableOn, sequential, seriesColor } from "../lib/theme";

// Redfin's median sale price is the median of whatever sold in the 3-month window; on a dozen sales
// it swings ±20% a year from the mix alone. Below this many sales its YoY is greyed and unshaded.
// ZHVI is Zillow's estimate across every home, so its YoY doesn't depend on how many sold.
const MIN_SALES = 30;
const thinSample = (r) => r.homes_sold != null && r.homes_sold < MIN_SALES;

const COLS = [
  { key: "geo", label: "ZIP · area", sort: "geo_id", align: "left" },
  { key: "median_sale_price", label: "Median sale", fmt: fmtCompactCurrency, heat: "seq" },
  { key: "price_yoy_pct", label: "YoY", fmt: (v) => fmt.signedPct(v, 0), heat: "div", needsSales: true },
  { key: "zhvi", label: "ZHVI", fmt: fmtCompactCurrency, heat: "seq" },
  { key: "zhvi_yoy_pct", label: "YoY", fmt: (v) => fmt.signedPct(v, 1), heat: "div" },
  { key: "zori", label: "Rent", fmt: (v) => (v != null ? fmt.currency(v) : "—") },
  { key: "gross_yield_pct", label: "Yield", fmt: (v) => fmt.pct(v, 1), heat: "seq" },
  { key: "price_psf", label: "$/sqft", fmt: (v) => (v != null ? `$${Math.round(v)}` : "—"), heat: "seq" },
  { key: "median_dom", label: "DOM", fmt: (v) => (v != null ? Math.round(v) : "—"), heat: "seqrev" },
  { key: "months_supply", label: "Supply", fmt: (v) => fmt.num(v), heat: "seqrev" },
  { key: "homes_sold", label: "Sold", fmt: fmt.int },
  { key: "active_listings", label: "Active", fmt: fmt.int },
  { key: "sale_to_list_ratio", label: "Sale/list", fmt: (v) => fmt.pct(v, 1) },
  { key: "spark", label: "24-mo price", sort: null },
];

export default function Scorecard({ ctx }) {
  const { scorecard, theme, navigate, macro } = ctx;
  const [parish, setParish] = useState("all");
  const [sortKey, setSortKey] = useState("zhvi");
  const [dir, setDir] = useState(-1);
  const rows = useMemo(() => {
    const all = (scorecard?.rows || []).filter((r) => r.geo_level === "zip" && (parish === "all" || r.parish === parish));
    const k = sortKey;
    return [...all].sort((a, b) => {
      const av = a[k] ?? (k === "geo_id" ? "" : -Infinity);
      const bv = b[k] ?? (k === "geo_id" ? "" : -Infinity);
      return (av > bv ? 1 : av < bv ? -1 : 0) * dir;
    });
  }, [scorecard, parish, sortKey, dir]);

  const thin = rows.filter(thinSample);

  // ZIPs with no ZORI: Zillow publishes its rent index only where it has enough listings.
  const noRent = rows.filter((r) => r.zori == null).map((r) => r.geo_id);

  const ranges = useMemo(() => {
    const out = {};
    for (const c of COLS) {
      if (!c.heat) continue;
      const vals = rows.filter((r) => !(c.needsSales && thinSample(r))).map((r) => r[c.key]).filter((v) => v != null);
      if (!vals.length) continue;
      out[c.key] = { min: Math.min(...vals), max: Math.max(...vals), absmax: Math.max(...vals.map(Math.abs)) };
    }
    return out;
  }, [rows]);

  function cellStyle(c, v) {
    const r = ranges[c.key];
    if (!c.heat || v == null || !r) return undefined;
    let background;
    if (c.heat === "div") background = diverging(r.absmax ? v / r.absmax : 0, theme);
    else {
      let t = r.max === r.min ? 0.5 : (v - r.min) / (r.max - r.min);
      if (c.heat === "seqrev") t = 1 - t;
      background = sequential(t, theme);
    }
    return { background, color: readableOn(background) };
  }
  function strong(c, v) {
    const r = ranges[c.key];
    if (!c.heat || v == null || !r) return false;
    if (c.heat === "div") return Math.abs(v / (r.absmax || 1)) > 0.66;
    let t = r.max === r.min ? 0.5 : (v - r.min) / (r.max - r.min);
    if (c.heat === "seqrev") t = 1 - t;
    return t > 0.66;
  }

  function sortBy(c) {
    const k = c.sort === undefined ? c.key : c.sort;
    if (!k) return;
    if (sortKey === k) setDir(-dir);
    else {
      setSortKey(k);
      setDir(k === "geo_id" ? 1 : -1);
    }
  }

  if (!scorecard) return <div className="loading">Loading…</div>;

  return (
    <div>
      <div className="btn-row">
        <div className="seg" role="group" aria-label="Parish">
          {[
            ["all", "All ZIPs"],
            ["jefferson", "Metairie · Jefferson"],
            ["orleans", "New Orleans · Orleans"],
          ].map(([id, label]) => (
            <button key={id} className={`seg-btn${parish === id ? " is-active" : ""}`} onClick={() => setParish(id)} aria-pressed={parish === id}>
              {label}
            </button>
          ))}
        </div>
        <span className="stat-note">Click a column to sort · click a row to open that ZIP · cell shading: blue = higher (DOM, supply reversed), YoY red/blue = down/up</span>
      </div>

      <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="ZIP Scorecard">
          <table className="data-table scorecard-table">
            <thead>
              <tr>
                {COLS.map((c) => {
                  const k = c.sort === undefined ? c.key : c.sort;
                  return (
                    <th key={c.key} className={`${c.align === "left" ? "" : "num"}${k ? " sortable" : ""}${sortKey === k ? " is-sorted" : ""}`} aria-sort={sortKey === k ? (dir > 0 ? "ascending" : "descending") : undefined}>
                      {k ? (
                        <button type="button" className="th-sort" onClick={() => sortBy(c)}>
                          {c.label}
                          {sortKey === k && <span aria-hidden="true">{dir > 0 ? " ▲" : " ▼"}</span>}
                        </button>
                      ) : (
                        c.label
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.geo_id} className="clickable" onClick={() => navigate({ view: "overview", geo: `zip:${r.geo_id}` })}>
                  {COLS.map((c) => {
                    if (c.key === "geo")
                      return (
                        <td key="geo">
                          {/* The row opens the ZIP on a click anywhere; this button is the keyboard way in. */}
                          <button
                            type="button"
                            className="geo-cell row-link"
                            aria-label={`Open the ${r.geo_id} ${r.name} market`}
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate({ view: "overview", geo: `zip:${r.geo_id}` });
                            }}
                          >
                            <span className="geo-id">{r.geo_id}</span>
                            <span className="geo-name">{r.name}</span>
                          </button>
                        </td>
                      );
                    if (c.key === "spark") return <td key="spark"><Sparkline values={r.spark_price} width={80} height={22} /></td>;
                    const v = r[c.key];
                    if (c.needsSales && thinSample(r) && v != null)
                      return (
                        <td key={c.key} className="num">
                          <span className="thin-sample" title={`Only ${fmt.int(r.homes_sold)} homes sold: too few for a reliable year-over-year change`}>
                            {c.fmt(v)}†
                          </span>
                        </td>
                      );
                    const style = cellStyle(c, v);
                    return (
                      <td key={c.key} className="num">
                        {style ? <span className={`heat${strong(c, v) ? " strong" : ""}`} style={style}>{c.fmt(v)}</span> : c.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {thin.length > 0 && (
        <div className="stat-note" style={{ margin: "-6px 0 8px" }}>
          {`† Fewer than ${MIN_SALES} homes sold in the 3-month window (${thin.map((r) => r.geo_id).join(", ")}): the median sale price moves a lot on a few sales, so its YoY is greyed and left out of the shading. ZHVI's YoY covers every home, so it stands.`}
        </div>
      )}
      {noRent.length > 0 && (
        <div className="stat-note" style={{ margin: "-6px 0 16px" }}>
          {`No rent or yield for ${noRent.join(", ")}: Zillow publishes its rent index only where it has enough rental listings.`}
        </div>
      )}

      <div className="panel-grid">
        <YieldPanel rows={rows} theme={theme} />
        <AffordabilityPanel rows={rows} theme={theme} macro={macro} />
      </div>
    </div>
  );
}

function BarList({ items, color, format }) {
  const max = Math.max(...items.map((i) => i.value || 0), 0) || 1;
  return (
    <div className="bar-list">
      {items.map((it) => (
        <div className="bar-row" key={it.id} title={`${it.label}: ${format(it.value)}`}>
          <div className="bar-label">
            <span>{it.id}</span>
            <small>{it.label}</small>
          </div>
          <div className="bar-track">
            <div className="bar-fill" style={{ width: `${Math.max(2, (it.value / max) * 100)}%`, background: color }} />
          </div>
          <div className="bar-value">{format(it.value)}</div>
        </div>
      ))}
    </div>
  );
}

function YieldPanel({ rows, theme }) {
  const items = rows.filter((r) => r.gross_yield_pct != null).sort((a, b) => b.gross_yield_pct - a.gross_yield_pct).map((r) => ({ id: r.geo_id, label: r.name, value: r.gross_yield_pct }));
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Rent vs. buy · gross rent yield</h2>
          <div className="panel-subtitle">Zillow typical rent × 12 ÷ typical home value. Higher = rents cover more of the price.</div>
        </div>
      </div>
      {items.length ? <BarList items={items} color={seriesColor(0, theme)} format={(v) => fmt.pct(v, 1)} /> : <div className="empty">Rent data not published for these ZIPs.</div>}
    </div>
  );
}

function AffordabilityPanel({ rows, theme, macro }) {
  const fredRate = macro?.mortgage_rate_30yr?.value;
  const a = useCostAssumptions(fredRate);
  const [costs, setCosts] = useState(null);
  useEffect(() => {
    // getOwnershipCosts never rejects (api.js falls back to { zips: {} }), so empty `zips`
    // after load is the failure signal, not a thrown error.
    getOwnershipCosts()
      .then(setCosts)
      .catch(() => setCosts({ zips: {} }));
  }, []);
  // While the ZIP tables load, the bars aren't rendered at all: computing with costs === null
  // showed $0 tax and flood on first paint and jumped when the data landed.
  const costsFailed = costs != null && Object.keys(costs.zips || {}).length === 0;
  const items = rows
    .filter((r) => r.median_sale_price != null)
    .map((r) => {
      const z = costs?.zips?.[r.geo_id] || {};
      const cost = monthlyCost({
        price: r.median_sale_price,
        downPct: a.down,
        ratePct: a.rate,
        taxAnnual: annualTax(z.tax, r.median_sale_price, { homestead: a.homestead, exempt: costs?.homestead_exempt_value }),
        homeownersAnnual: a.homeowners,
        floodAnnual: a.includeFlood ? z.flood?.all?.median : 0,
      });
      return { id: r.geo_id, label: r.name, cost };
    })
    .sort((x, y) => y.cost.total - x.cost.total);
  const max = Math.max(...items.map((i) => i.cost.total), 1);
  const missingTax = costs && items.some((i) => !costs.zips?.[i.id]?.tax);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Affordability · true monthly cost of the median sale</h2>
          <div className="panel-subtitle">
            Each ZIP's median sale price with a 30-year fixed loan, plus property tax at the ZIP's rate
            ({a.homestead ? "with the homestead exemption for a home you live in" : "on the full price, as a rental or second home"}),
            your homeowners estimate and the ZIP's median flood policy. An estimate, not a loan offer or insurance quote; HOA dues and mortgage insurance aren't included.
          </div>
        </div>
      </div>
      <CostInputs a={a} />
      {costs === null ? (
        <div className="loading">Loading tax and flood figures…</div>
      ) : costsFailed ? (
        <div className="empty">
          Tax and flood figures couldn't be loaded, so the monthly costs can't be built — showing the
          loan payment alone would understate them. Try reloading the page.
        </div>
      ) : (
        <>
          <div className="stat-note" style={{ margin: "8px 0 10px" }}>
            {fredRate != null ? `Rate starts at the latest Freddie Mac average from FRED (${fmt.pct(fredRate, 2)}). ` : ""}
            Homeowners insurance is your estimate for every ZIP (published 2026 Louisiana averages run {HOMEOWNERS_RANGE}).
            {missingTax ? " Some ZIPs have no published tax rate and show $0 tax." : ""}
          </div>
          <CostLegend theme={theme} />
          <div className="bar-list">
            {items.map((it) => (
              <div
                className="bar-row"
                key={it.id}
                title={`${it.label}: ${COST_PARTS.map((p) => `${p.label} ${fmt.currency(it.cost[p.key])}`).join(" · ")} — ${fmt.currency(it.cost.total)}/mo`}
              >
                <div className="bar-label">
                  <span>{it.id}</span>
                  <small>{it.label}</small>
                </div>
                <StackedCostBar cost={it.cost} max={max} theme={theme} />
                <div className="bar-value">{fmt.currency(it.cost.total)}</div>
              </div>
            ))}
          </div>
          <div className="stat-note" style={{ marginTop: 8 }}>Monthly totals. Hover a bar for the breakdown.</div>
        </>
      )}
    </div>
  );
}
