import { useEffect, useRef, useState } from "react";
import { seriesColor } from "../lib/theme";

// Same tiles as the nearby-homes map (see NearbyMap.jsx). Markers draw on one canvas, so an owner
// with 1,500 properties stays quick on a phone.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Popup built with DOM calls, not an HTML string: addresses are data.
function popupContent(r, onPick) {
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "map-popup-title";
  title.textContent = (r.label || "").split(",")[0];
  const sub = document.createElement("div");
  sub.className = "map-popup-sub";
  sub.textContent = [r.zip, r.zone ? `zone ${r.zone}` : null].filter(Boolean).join(" · ");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "link-button";
  btn.textContent = "View this property";
  btn.addEventListener("click", () => onPick(r));
  box.append(title, sub, btn);
  return box;
}

/** Every property one owner holds. Key it by owner so each gets a fresh map. */
export default function OwnerMap({ records, theme, onPick }) {
  const el = useRef(null);
  const [failed, setFailed] = useState(false);
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);
  const placed = records.filter((r) => r.lat != null && r.lng != null);

  useEffect(() => {
    let map = null;
    let cancelled = false;
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([mod]) => {
        if (cancelled || !el.current || !placed.length) return;
        const L = mod.default || mod;
        map = L.map(el.current, { scrollWheelZoom: false, preferCanvas: true });
        L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
        const color = seriesColor(1, theme);
        const points = [];
        for (const r of placed) {
          L.circleMarker([r.lat, r.lng], { radius: 5, color: "#fff", weight: 1, fillColor: color, fillOpacity: 0.85 })
            .bindPopup(() => popupContent(r, (x) => pickRef.current(x)))
            .addTo(map);
          points.push([r.lat, r.lng]);
        }
        map.fitBounds(points, { padding: [24, 24], maxZoom: 17 });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      map?.remove();
    };
    // Drawn once per owner (the component is keyed by it).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!placed.length) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">Map</h3>
          <div className="panel-subtitle">{`${placed.length.toLocaleString()} properties with a location on record. Tap a dot for its details.`}</div>
        </div>
      </div>
      {failed ? <div className="empty">The map couldn't load. The list below still works.</div> : <div ref={el} className={`nearby-map${theme === "dark" ? " nearby-map--dark" : ""}`} role="region" aria-label="Map of this owner's properties" />}
    </div>
  );
}
