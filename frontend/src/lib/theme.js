// Data-viz palette: the validated reference categorical set (8 slots, fixed order,
// never cycled) stepped per mode, plus one-hue sequential and a blue<->red diverging
// pair. Validated with the dataviz skill's validator against the app surfaces
// (#ffffff light, #10151f dark). Chrome colors live in index.css as CSS variables.
export const SERIES_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
export const SERIES_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

export function seriesColor(slot, theme) {
  const pal = theme === "light" ? SERIES_LIGHT : SERIES_DARK;
  return pal[slot % pal.length];
}

// Each metric keeps the same slot everywhere it appears, so a reader who learns
// "ZHVI is blue" is never misled by another chart.
export const METRIC_SLOT = {
  zhvi: 0,
  redfin_median_sale_price: 1,
  zori: 2,
  redfin_new_listings: 0,
  redfin_homes_sold: 1,
  redfin_pending_sales: 2,
  redfin_active_listings: 0,
  redfin_months_supply: 1,
  redfin_median_dom: 0,
  redfin_sale_to_list_ratio: 0,
  redfin_pct_sold_above_list: 1,
  redfin_pct_price_drops: 1,
  redfin_pct_off_market_2wk: 0,
  redfin_median_sale_price_psf: 1,
  mortgage_rate_30yr: 0,
  nola_metro_hpi: 0,
  jefferson_hpi: 1,
  orleans_hpi: 2,
};

// Sequential (blue, light->dark) and diverging (blue <-> red, gray midpoint) ramps.
export const SEQ_LIGHT = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7", "#3987e5"];
export const SEQ_DARK = ["#0d366b", "#104281", "#184f95", "#1c5cab", "#256abf", "#2a78d6", "#3987e5"];

export function sequential(t, theme) {
  const ramp = theme === "light" ? SEQ_LIGHT : SEQ_DARK;
  if (t == null || Number.isNaN(t)) return "transparent";
  const i = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
  return ramp[i];
}

// Text color for a filled cell: white or near-black, whichever contrasts more with the fill
// (WCAG relative luminance). Mid-tone fills like #3987e5 fail with white and with dark gray.
const INK_DARK = "#0a0e17";
function luminance(hex) {
  const n = String(hex).replace("#", "");
  if (n.length !== 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function readableOn(fill) {
  const l = luminance(fill);
  if (l == null) return undefined;
  const onWhite = 1.05 / (l + 0.05);
  const onDark = (l + 0.05) / (luminance(INK_DARK) + 0.05);
  return onWhite >= onDark ? "#ffffff" : INK_DARK;
}

// t in [-1, 1]; negative -> red arm, positive -> blue arm, 0 -> neutral gray.
export function diverging(t, theme) {
  if (t == null || Number.isNaN(t)) return "transparent";
  const light = theme === "light";
  const mid = light ? "#f0efec" : "#383835";
  const blue = light ? ["#b7d3f6", "#6da7ec", "#2269c4"] : ["#1c5cab", "#256abf", "#3987e5"];
  const red = light ? ["#f6c9c9", "#ee8f8e", "#e34948"] : ["#7a2323", "#a83636", "#e66767"];
  const a = Math.min(1, Math.abs(t));
  if (a < 0.12) return mid;
  const arm = t > 0 ? blue : red;
  return arm[Math.min(2, Math.floor(a * 3))];
}

export const fmtCompactCurrency = (v) => {
  if (v == null) return "";
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2).replace(/0$/, "")}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmt = {
  currency: (v) => (v != null ? `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"),
  compact: (v) => (v != null ? fmtCompactCurrency(v) : "—"),
  num: (v) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"),
  int: (v) => (v != null ? Number(v).toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"),
  pct: (v, digits = 1) => (v != null ? `${Number(v).toFixed(digits)}%` : "—"),
  signedPct: (v, digits = 1) => {
    if (v == null) return "—";
    const s = Number(v).toFixed(digits);
    if (Number(s) === 0) return "0%"; // a change that rounds to zero is "0%", never "-0%"
    return `${Number(v) > 0 ? "+" : ""}${s}%`;
  },
  days: (v) => (v != null ? `${Math.round(v)} d` : "—"),
  raw: (v) => (v != null && v !== "" ? String(v) : "—"),
  date: (v) => {
    if (!v) return "—";
    const [y, m, d] = String(v).split("-").map(Number);
    if (!y || !m) return String(v);
    return d ? `${MONTHS[m - 1]} ${d}, ${y}` : `${MONTHS[m - 1]} ${y}`;
  },
  monthYear: (v) => {
    if (!v) return "—";
    const [y, m] = String(v).split("-").map(Number);
    if (!y || !m) return String(v);
    return `${MONTHS[m - 1]} ${y}`;
  },
};

// Monthly P&I payment for a 30-year fixed at annual rate `ratePct`.
export function monthlyPayment(principal, ratePct, years = 30) {
  if (!principal || ratePct == null) return null;
  const r = ratePct / 100 / 12;
  const n = years * 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}
