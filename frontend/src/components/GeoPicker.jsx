import { useState } from "react";
import { geoKey } from "../lib/geo";

const DEFAULT_VISIBLE = 8;

// Parish-grouped ZIP chips. Single-select (gold) or multi-select (each chip keeps
// the series color it was assigned when selected, so color follows the entity).
// Each ZIP's neighborhood name rides as a title tooltip and only prints inline
// once selected, so an unopened group reads as a short run of ZIP codes rather
// than a wall of names; long groups collapse behind a "+N more" toggle, and any
// already-selected ZIP stays visible even while its group is collapsed.
export default function GeoPicker({ geos, selected, onToggle, multi = false, colorOf, max = 6 }) {
  const [expanded, setExpanded] = useState({});
  if (!geos) return <div className="loading">Loading geographies…</div>;
  const isSel = (g) => selected.some((s) => s.geo_level === g.geo_level && s.geo_id === g.geo_id);
  const groups = [
    { label: "Metro & parishes", items: geos.filter((g) => g.geo_level !== "zip"), collapsible: false },
    {
      label: "Metairie · Jefferson",
      items: geos.filter((g) => g.geo_level === "zip" && g.parish === "jefferson"),
      collapsible: true,
    },
    {
      label: "New Orleans · Orleans",
      items: geos.filter((g) => g.geo_level === "zip" && g.parish === "orleans"),
      collapsible: true,
    },
  ];
  const full = multi && selected.length >= max;

  return (
    <div className="geo-groups" role={multi ? "group" : "tablist"} aria-label="Geography">
      {groups.map((grp) => {
        const isExpanded = !grp.collapsible || grp.items.length <= DEFAULT_VISIBLE || expanded[grp.label];
        // Keep the first DEFAULT_VISIBLE ZIPs plus any already-selected one further
        // down the list, so collapsing a group never hides the current selection.
        const visible = isExpanded ? grp.items : grp.items.filter((g, i) => i < DEFAULT_VISIBLE || isSel(g));
        const hiddenCount = grp.items.length - visible.length;

        return (
          <div className="geo-group" key={grp.label}>
            <span className="geo-group-label">{grp.label}</span>
            {visible.map((g) => {
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
                  {g.geo_level === "zip" && g.name && active && (
                    <span style={{ color: "var(--text-dimmer)", fontWeight: 400, fontSize: 11 }}>{g.name}</span>
                  )}
                </button>
              );
            })}
            {hiddenCount > 0 && (
              <button
                className="btn btn-sm geo-more"
                onClick={() => setExpanded((prev) => ({ ...prev, [grp.label]: true }))}
              >
                +{hiddenCount} more
              </button>
            )}
            {grp.collapsible && expanded[grp.label] && grp.items.length > DEFAULT_VISIBLE && (
              <button
                className="btn btn-sm geo-more"
                onClick={() => setExpanded((prev) => ({ ...prev, [grp.label]: false }))}
              >
                Show less
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
