import { RANGES } from "../lib/rangeUtils";

export default function RangeToggle({ value, onChange, right = true }) {
  return (
    <div className={`seg${right ? " seg--right" : ""}`} role="group" aria-label="Time range">
      {RANGES.map((r) => (
        <button
          key={r.id}
          className={`seg-btn${value === r.id ? " is-active" : ""}`}
          onClick={() => onChange(r.id)}
          aria-pressed={value === r.id}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}
