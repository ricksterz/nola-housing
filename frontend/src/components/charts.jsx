import { CartesianGrid, Legend, Line, Tooltip, XAxis, YAxis } from "recharts";
import { fmt, fmtCompactCurrency, METRIC_SLOT, seriesColor } from "../lib/theme";

// Shared recharts props implementing the mark spec: 2px lines, no per-point dots,
// >=8px end/hover markers ringed in the surface color, hairline horizontal grid.
export const tick = { fontSize: 11 };
export const xAxisProps = { tick, tickLine: false, axisLine: false, minTickGap: 48 };
export const yAxisProps = { tick, tickLine: false, axisLine: false, width: 44 };
export const currencyAxis = { ...yAxisProps, tickFormatter: fmtCompactCurrency, width: 54, domain: ["auto", "auto"] };
export const gridProps = { vertical: false, strokeWidth: 1 };
export const legendProps = { iconType: "plainline", iconSize: 14, wrapperStyle: { fontSize: 12 } };
export const lineProps = {
  type: "monotone",
  dot: false,
  strokeWidth: 2,
  connectNulls: true,
  activeDot: { r: 4, strokeWidth: 2, stroke: "var(--panel)" },
  isAnimationActive: false,
};

export const tooltipStyle = {
  contentStyle: { background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 },
  labelStyle: { color: "var(--text-dim)", marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: "var(--text-dimmer)", strokeWidth: 1 },
};

export const FORMAT = {
  currency: (v) => fmtCompactCurrency(v),
  currencyFull: (v) => fmt.currency(v),
  int: (v) => fmt.int(v),
  num: (v) => fmt.num(v),
  pct: (v) => fmt.pct(v),
  days: (v) => fmt.days(v),
  index: (v) => fmt.num(v),
};

export function MetricLine({ metric, name, theme, ...rest }) {
  return (
    <Line {...lineProps} dataKey={metric} name={name} stroke={seriesColor(METRIC_SLOT[metric] ?? 0, theme)} {...rest} />
  );
}

// Standard chart chrome: grid + axes + tooltip (+ legend only when >= 2 series).
export function Frame({ xKey = "monthLabel", yFormat = "num", yAxis = yAxisProps, series = 2, tooltipFormatter }) {
  return (
    <>
      <CartesianGrid {...gridProps} />
      <XAxis dataKey={xKey} {...xAxisProps} />
      <YAxis {...yAxis} tickFormatter={yAxis.tickFormatter || FORMAT[yFormat]} />
      <Tooltip {...tooltipStyle} formatter={tooltipFormatter || ((v) => FORMAT[yFormat === "currency" ? "currencyFull" : yFormat](v))} />
      {series >= 2 && <Legend {...legendProps} />}
    </>
  );
}
