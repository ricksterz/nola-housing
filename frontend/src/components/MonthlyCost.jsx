import { COST_PARTS, HOMEOWNERS_RANGE } from "../lib/costs";
import { fmt, seriesColor } from "../lib/theme";

/** Rate / down / homeowners / flood toggle, bound to useCostAssumptions(). */
export function CostInputs({ a, children }) {
  return (
    <div className="chart-actions cost-inputs">
      {children}
      <label className="field">
        Rate <input className="num-input" type="number" step="0.125" min="0" max="20" value={a.rate} onChange={(e) => a.set({ rate: Number(e.target.value) })} />%
      </label>
      <label className="field">
        Down <input className="num-input" type="number" step="5" min="0" max="100" value={a.down} onChange={(e) => a.set({ down: Number(e.target.value) })} />%
      </label>
      <label className="field" title={`Your estimate. Published 2026 Louisiana averages range from ${HOMEOWNERS_RANGE}; get a quote.`}>
        Homeowners $<input className="num-input num-input--wide" type="number" step="100" min="0" value={a.homeowners} onChange={(e) => a.set({ homeowners: Number(e.target.value) })} />/yr
      </label>
      <label className="field">
        <input type="checkbox" checked={a.includeFlood} onChange={(e) => a.set({ includeFlood: e.target.checked })} /> Flood insurance
      </label>
    </div>
  );
}

export function CostLegend({ theme, parts = COST_PARTS }) {
  return (
    <div className="legend-inline">
      {parts.map((p) => (
        <span key={p.key}>
          <i className="legend-swatch" style={{ background: seriesColor(p.slot, theme) }} />
          {p.label}
        </span>
      ))}
    </div>
  );
}

/** One horizontal bar split into cost parts, scaled to ``max``. */
export function StackedCostBar({ cost, max, theme }) {
  return (
    <div className="bar-track bar-track--stacked">
      {COST_PARTS.map((p) =>
        cost[p.key] > 0 ? (
          <div
            key={p.key}
            className="bar-seg"
            style={{ width: `${(cost[p.key] / max) * 100}%`, background: seriesColor(p.slot, theme) }}
            title={`${p.label}: ${fmt.currency(cost[p.key])}/mo`}
          />
        ) : null
      )}
    </div>
  );
}
