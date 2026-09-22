import { useEffect, useMemo, useState } from "react";
import { Line, LineChart } from "recharts";
import { getCompare } from "../api";
import ChartPanel from "../components/ChartPanel";
import GeoPicker from "../components/GeoPicker";
import RangeToggle from "../components/RangeToggle";
import { Frame, currencyAxis, lineProps, yAxisProps } from "../components/charts";
import { geoKey, geoLabel, parseGeo } from "../lib/geo";
import { filterRange, monthLabel } from "../lib/rangeUtils";
import { fmt, fmtCompactCurrency, seriesColor } from "../lib/theme";

const METRICS = [
  { key: "zhvi", label: "Home value (ZHVI)", fmt: "currency" },
  { key: "redfin_median_sale_price", label: "Median sale price", fmt: "currency" },
  { key: "zori", label: "Rent (ZORI)", fmt: "currency" },
  { key: "redfin_median_sale_price_psf", label: "Sale $/sqft", fmt: "num" },
  { key: "redfin_median_dom", label: "Days on market", fmt: "days" },
  { key: "redfin_active_listings", label: "Active listings", fmt: "int" },
  { key: "redfin_months_supply", label: "Months of supply", fmt: "num" },
  { key: "redfin_homes_sold", label: "Homes sold", fmt: "int" },
];
const MAX = 6;
const DEFAULT = ["zip:70005", "zip:70118", "zip:70124", "zip:70115"];

export default function Compare({ ctx }) {
  const { geos, theme, navigate, url } = ctx;
  const selected = useMemo(() => (url.geos ? url.geos.split(",") : DEFAULT).map(parseGeo).filter(Boolean), [url.geos]);
  const metric = METRICS.find((m) => m.key === url.metric) || METRICS[0];
  const indexed = url.indexed === "1";
  const [range, setRange] = useState(url.range || "2020");
  const [compare, setCompare] = useState(null);
  const [error, setError] = useState(null);
  // Slot assignment is sticky: a geo keeps its color while it stays selected.
  const [slots, setSlots] = useState(() => Object.fromEntries(selected.map((g, i) => [geoKey(g), i])));

  useEffect(() => {
    getCompare().then(setCompare).catch((e) => setError(e.message));
  }, []);

  function toggle(g) {
    const k = geoKey(g);
    const has = selected.some((s) => geoKey(s) === k);
    let next;
    if (has) {
      next = selected.filter((s) => geoKey(s) !== k);
      setSlots((prev) => {
        const p = { ...prev };
        delete p[k];
        return p;
      });
    } else {
      if (selected.length >= MAX) return;
      next = [...selected, g];
      setSlots((prev) => {
        const used = new Set(Object.values(prev));
        let slot = 0;
        while (used.has(slot)) slot++;
        return { ...prev, [k]: slot };
      });
    }
    navigate({ geos: next.map(geoKey).join(",") });
  }
  const colorOf = (g) => seriesColor(slots[geoKey(g)] ?? 0, theme);

  const merged = useMemo(() => {
    if (!compare) return [];
    const months = new Set();
    selected.forEach((g) => (compare.geos[g.geo_id] || []).forEach((d) => d[metric.key] != null && months.add(d.month)));
    const rows = filterRange(Array.from(months).sort().map((m) => ({ month: m })), range);
    const base = {};
    return rows.map(({ month }) => {
      const row = { month, monthLabel: monthLabel(month) };
      for (const g of selected) {
        const pt = (compare.geos[g.geo_id] || []).find((d) => d.month === month);
        let v = pt?.[metric.key] ?? null;
        if (indexed && v != null) {
          if (base[g.geo_id] == null) base[g.geo_id] = v;
          v = (v / base[g.geo_id]) * 100;
        }
        row[g.geo_id] = v;
      }
      return row;
    });
  }, [compare, selected, metric.key, range, indexed]);

  const fmtVal = (v) => {
    if (v == null) return "—";
    if (indexed) return fmt.num(v);
    if (metric.fmt === "currency") return fmt.currency(v);
    if (metric.fmt === "days") return fmt.days(v);
    if (metric.fmt === "int") return fmt.int(v);
    return fmt.num(v);
  };
  const yAxis = indexed ? { ...yAxisProps, domain: ["auto", "auto"] } : metric.fmt === "currency" ? currencyAxis : { ...yAxisProps, domain: ["auto", "auto"] };
  const columns = [{ key: "month", label: "Month", type: "monthYear" }, ...selected.map((g) => ({ key: g.geo_id, label: geoLabel(g, geos), type: indexed ? "num" : metric.fmt === "days" ? "days" : metric.fmt === "int" ? "int" : metric.fmt === "currency" ? "currency" : "num" }))];
  const latest = (g) => {
    for (let i = merged.length - 1; i >= 0; i--) if (merged[i][g.geo_id] != null) return merged[i][g.geo_id];
    return null;
  };

  return (
    <div>
      <div className="btn-row">
        <div className="seg" role="group" aria-label="Metric">
          {METRICS.map((m) => (
            <button key={m.key} className={`seg-btn${metric.key === m.key ? " is-active" : ""}`} onClick={() => navigate({ metric: m.key })} aria-pressed={metric.key === m.key}>
              {m.label}
            </button>
          ))}
        </div>
        <button className={`btn btn-sm${indexed ? " is-active" : ""}`} onClick={() => navigate({ indexed: indexed ? null : "1" })} aria-pressed={indexed} title="Rebase every series to 100 at the start of the range to compare growth, not level">
          Indexed = 100
        </button>
        <RangeToggle value={range} onChange={(r) => { setRange(r); navigate({ range: r }, { replace: true }); }} />
      </div>

      <GeoPicker geos={geos} selected={selected} onToggle={toggle} multi colorOf={colorOf} max={MAX} />
      <div className="stat-note" style={{ marginTop: -10, marginBottom: 14 }}>
        Pick up to {MAX} areas. Each keeps its color while selected.
      </div>

      {error && <div className="error">Could not load market data: {error}</div>}
      {!compare && !error && <div className="loading">Loading…</div>}

      {compare && selected.length > 0 && (
        <>
          <ChartPanel
            title={`${metric.label}${indexed ? " · indexed to 100" : ""}`}
            subtitle={indexed ? "Each area rebased to 100 at the first month of the range" : "Overlay of the selected areas"}
            rows={merged}
            columns={columns}
            wide
          >
            <LineChart data={merged}>
              <Frame yFormat={indexed ? "num" : metric.fmt === "currency" ? "currency" : metric.fmt} yAxis={yAxis} series={selected.length} tooltipFormatter={fmtVal} />
              {selected.map((g) => (
                <Line key={g.geo_id} {...lineProps} dataKey={g.geo_id} name={geoLabel(g, geos)} stroke={colorOf(g)} />
              ))}
            </LineChart>
          </ChartPanel>

          <div className="panel">
            <div className="panel-head">
              <div>
                <h3 className="panel-title">Small multiples</h3>
                <div className="panel-subtitle">Same metric, one panel per area, shared y-scale</div>
              </div>
            </div>
            <div className="small-multiples">
              {selected.map((g) => (
                <div className="small-multiple" key={g.geo_id}>
                  <div className="small-multiple-head">
                    <span className="small-multiple-title">
                      <span className="swatch" style={{ width: 9, height: 9, borderRadius: "50%", background: colorOf(g), display: "inline-block" }} />
                      {geoLabel(g, geos)}
                    </span>
                    <span className="small-multiple-value">{indexed ? fmt.num(latest(g)) : metric.fmt === "currency" ? fmtCompactCurrency(latest(g)) : fmtVal(latest(g))}</span>
                  </div>
                  <div className="chart-box chart-box--xs">
                    <SmallChart data={merged} dataKey={g.geo_id} color={colorOf(g)} yAxis={yAxis} fmtVal={fmtVal} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SmallChart({ data, dataKey, color, yAxis, fmtVal }) {
  const { ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip } = require_recharts();
  const domain = useMemo(() => {
    const vals = data.flatMap((r) => Object.entries(r).filter(([k]) => k !== "month" && k !== "monthLabel").map(([, v]) => v)).filter((v) => v != null);
    if (!vals.length) return ["auto", "auto"];
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.05 || 1;
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [data]);
  const tickFormatter = yAxis.tickFormatter || ((v) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}K` : Math.round(v)));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 4, right: 6, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="monthLabel" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} minTickGap={60} />
        <YAxis {...yAxis} domain={domain} tickFormatter={tickFormatter} tick={{ fontSize: 10 }} width={46} />
        <Tooltip formatter={fmtVal} contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} cursor={{ stroke: "var(--text-dimmer)" }} />
        <Line {...lineProps} dataKey={dataKey} stroke={color} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// recharts is imported at module scope above for the main chart; the small chart
// re-exports what it needs to keep the JSX above readable.
import * as Recharts from "recharts";
function require_recharts() {
  return Recharts;
}
