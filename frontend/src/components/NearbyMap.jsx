import { useEffect, useRef, useState } from "react";
import { getNearbyRows } from "../api";
import { NEAR_RADIUS_M, fmtDistance, nearestHomes } from "../lib/nearby";
import { fmt, seriesColor } from "../lib/theme";

// OpenStreetMap's standard tiles: free with attribution and no API key, fine for a site this size
// under the OSMF tile usage policy. There's no dark variant, so dark mode inverts them in CSS
// (.nearby-map--dark), which keeps streets and labels legible.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const LIST_COUNT = 8;

function homeLine(h) {
  return [
    fmtDistance(h.d),
    h.assessed ? `assessed ${fmt.currency(h.assessed)}` : null,
    h.sale ? `last sale ${fmt.currency(h.sale)}` : null,
    h.zone ? `zone ${h.zone}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

// Popup built with DOM calls, not an HTML string: street names are data.
function popupContent(h, onPick) {
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "map-popup-title";
  title.textContent = h.street;
  const sub = document.createElement("div");
  sub.className = "map-popup-sub";
  sub.textContent = homeLine(h);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "link-button";
  btn.textContent = "View this home";
  btn.addEventListener("click", () => onPick(h.street));
  box.append(title, sub, btn);
  return box;
}

/**
 * Map of one parcel and the homes around it, plus a list of the nearest ones. Key it by parcel so
 * each address gets a fresh map. Leaflet is loaded on demand, only when a property is open.
 */
export default function NearbyMap({ p, theme, onPick }) {
  const el = useRef(null);
  const leaflet = useRef(null); // { L, map, layer }
  const [homes, setHomes] = useState(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  // Popups are built once per marker; they call the latest onPick through this ref.
  const pickRef = useRef(onPick);
  useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    let cancelled = false;
    getNearbyRows(p.lat, p.lng)
      .then((rows) => !cancelled && setHomes(nearestHomes(rows, p.lat, p.lng, { selfKey: p.site_address_norm })))
      .catch(() => !cancelled && setHomes([]));
    return () => {
      cancelled = true;
    };
  }, [p.lat, p.lng, p.site_address_norm]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([mod]) => {
        if (cancelled || !el.current) return;
        const L = mod.default || mod;
        const map = L.map(el.current, { center: [p.lat, p.lng], zoom: 17, scrollWheelZoom: false });
        L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);
        leaflet.current = { L, map, layer: L.layerGroup().addTo(map) };
        setMapReady(true);
      })
      .catch(() => !cancelled && setMapFailed(true));
    return () => {
      cancelled = true;
      leaflet.current?.map.remove();
      leaflet.current = null;
    };
    // The map is created once per parcel (the component is keyed by it).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const lf = leaflet.current;
    if (!mapReady || !lf || !homes) return;
    const { L, layer } = lf;
    layer.clearLayers();
    const nearColor = seriesColor(0, theme);
    // SVG fill attributes don't resolve CSS variables, so read the theme's gold directly.
    const gold = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d4953a";
    for (const h of homes) {
      L.circleMarker([h.lat, h.lng], { radius: 6, color: "#fff", weight: 1, fillColor: nearColor, fillOpacity: 0.85 })
        .bindPopup(() => popupContent(h, (street) => pickRef.current(street)))
        .addTo(layer);
    }
    L.circleMarker([p.lat, p.lng], { radius: 10, color: "#fff", weight: 2, fillColor: gold, fillOpacity: 1 })
      .bindTooltip("This home", { direction: "top", offset: [0, -8] })
      .addTo(layer);
  }, [mapReady, homes, theme, p.lat, p.lng]);

  const listed = (homes || []).slice(0, LIST_COUNT);
  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">Map &amp; nearby homes</h3>
          <div className="panel-subtitle">
            Parcels within {fmtDistance(NEAR_RADIUS_M)}. Tap a dot for its details. Assessed values are tax values, not
            prices.
          </div>
        </div>
        <a className="btn" href={`https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`} target="_blank" rel="noreferrer">
          Google Maps ↗
        </a>
      </div>
      {mapFailed ? <div className="empty">The map couldn't load. The nearby list below still works.</div> : <div ref={el} className={`nearby-map${theme === "dark" ? " nearby-map--dark" : ""}`} role="region" aria-label="Map of this home and nearby homes" />}
      {homes === null ? (
        <div className="stat-note" style={{ marginTop: 10 }}>Finding nearby homes…</div>
      ) : listed.length ? (
        <ul className="nearby-list">
          {listed.map((h) => (
            <li key={h.key}>
              <button type="button" className="nearby-item" onClick={() => onPick(h.street)}>
                <span className="nearby-street">{h.street}</span>
                <span className="nearby-sub">{homeLine(h)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="stat-note" style={{ marginTop: 10 }}>No other parcels on record within {fmtDistance(NEAR_RADIUS_M)}.</div>
      )}
    </div>
  );
}
