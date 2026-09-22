import { fmt } from "../lib/theme";
import Sparkline from "./Sparkline";

// Stat tile contract: label · value · optional delta (signed, vs a named period,
// colored by direction × whether up is good) · optional 12-24 point sparkline.
export default function StatTile({ label, value, note, delta, deltaLabel = "YoY", upIsGood = true, spark, accent }) {
  // Arrow follows the sign of the change; color follows whether that change is good.
  let deltaCls = "flat";
  if (delta != null && Math.abs(delta) >= 0.05) deltaCls = (delta > 0) === upIsGood ? "up" : "down";
  const arrow = delta == null || Math.abs(delta) < 0.05 ? "" : delta > 0 ? "▲ " : "▼ ";
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className={`stat-value${accent ? " stat-value--accent" : ""}`}>{value ?? "—"}</div>
      {delta != null && (
        <div className={`stat-delta ${deltaCls}`}>
          {arrow}
          {fmt.signedPct(delta)} <span style={{ color: "var(--text-dimmer)", fontWeight: 400 }}>{deltaLabel}</span>
        </div>
      )}
      {spark && spark.length > 1 && <Sparkline values={spark} />}
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}
