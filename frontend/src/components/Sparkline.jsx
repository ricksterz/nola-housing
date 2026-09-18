// 24-point sparkline in the de-emphasis ink; the current period is the accent dot.
export default function Sparkline({ values, width = 96, height = 26, color = "var(--text-dimmer)" }) {
  const pts = (values || []).filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (pts.length < 2) return null;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const step = width / (pts.length - 1);
  const y = (v) => height - 3 - ((v - min) / span) * (height - 6);
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const lx = (pts.length - 1) * step;
  const ly = y(pts[pts.length - 1]);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block", marginTop: 4 }}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r="3" fill="var(--gold)" stroke="var(--panel)" strokeWidth="2" />
    </svg>
  );
}
