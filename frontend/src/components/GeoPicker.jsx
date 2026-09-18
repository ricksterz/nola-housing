import { geoKey } from "../lib/geo";

// Parish-grouped ZIP chips. Single-select (gold) or multi-select (each chip keeps
// the series color it was assigned when selected, so color follows the entity).
export default function GeoPicker({ geos, selected, onToggle, multi = false, colorOf, max = 6 }) {
  if (!geos) return <div className="loading">Loading geographies…</div>;
  const isSel = (g) => selected.some((s) => s.geo_level === g.geo_level && s.geo_id === g.geo_id);
  const groups = [
    { label: "Metro & parishes", items: geos.filter((g) => g.geo_level !== "zip") },
    { label: "Metairie · Jefferson", items: geos.filter((g) => g.geo_level === "zip" && g.parish === "jefferson") },
    { label: "New Orleans · Orleans", items: geos.filter((g) => g.geo_level === "zip" && g.parish === "orleans") },
  ];
  const full = multi && selected.length >= max;
  return (
    <div className="geo-groups" role={multi ? "group" : "tablist"} aria-label="Geography">
      {groups.map((grp) => (
        <div className="geo-group" key={grp.label}>
          <span className="geo-group-label">{grp.label}</span>
          {grp.items.map((g) => {
            const active = isSel(g);
            const color = active && multi && colorOf ? colorOf(g) : undefined;
            const label = g.geo_level === "zip" ? g.geo_id : g.name;
            const disabled = !active && full;
            return (
              <button
                key={geoKey(g)}
                role={multi ? "checkbox" : "tab"}
                aria-checked={multi ? active : undefined}
                aria-selected={!multi ? active : undefined}
                disabled={disabled}
                className={`btn btn-sm${active ? " is-active" : ""}`}
                style={color ? { "--active-color": color } : undefined}
                title={g.geo_level === "zip" ? g.name : undefined}
                onClick={() => onToggle(g)}
              >
                {color && <span className="swatch" style={{ background: color }} />}
                {label}
                {g.geo_level === "zip" && g.name && (
                  <span style={{ color: "var(--text-dimmer)", fontWeight: 400, fontSize: 11 }}>{g.name}</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
