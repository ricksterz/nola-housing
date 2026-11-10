import { useEffect, useRef, useState } from "react";

// Map of the AI data centers and the gas plants built for them (power.json "sites"). Same tiles
// as NearbyMap (OpenStreetMap, no key); dark mode tints them into the tracker's console look.
// Markers are divIcons styled in CSS (.pm-*), and tooltips are built with DOM calls, not HTML strings.
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function tip(site) {
  const box = document.createElement("div");
  const title = document.createElement("div");
  title.className = "pm-tip-title";
  title.textContent = site.name;
  const sub = document.createElement("div");
  sub.className = "pm-tip-sub";
  sub.textContent = site.note;
  box.append(title, sub);
  return box;
}

export default function PowerMap({ sites, theme }) {
  const el = useRef(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let map = null;
    Promise.all([import("leaflet"), import("leaflet/dist/leaflet.css")])
      .then(([mod]) => {
        if (cancelled || !el.current) return;
        const L = mod.default || mod;
        map = L.map(el.current, { scrollWheelZoom: false, zoomSnap: 0.25 });
        L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 12, minZoom: 6 }).addTo(map);
        for (const s of sites) {
          const icon = L.divIcon({
            className: "pm-icon",
            html: `<span class="pm-dot pm-dot--${s.kind} pm-dot--${s.stage}"></span>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          const marker = L.marker([s.lat, s.lng], { icon, title: s.name, keyboard: true }).addTo(map);
          const city = s.kind === "city";
          // The city is a permanent name label (below, clear of the plant and site beside it).
          marker.bindTooltip(city ? Object.assign(document.createElement("span"), { textContent: s.name }) : tip(s), {
            direction: city ? "bottom" : "top",
            offset: city ? [0, 6] : [0, -10],
            className: city ? "pm-tip pm-tip--label" : "pm-tip",
            permanent: city,
          });
        }
        // Fit once the container has its laid-out size (it can measure 0 the moment it mounts).
        const bounds = L.latLngBounds(sites.map((s) => [s.lat, s.lng]));
        map.fitBounds(bounds, { padding: [36, 36] });
        requestAnimationFrame(() => {
          if (cancelled) return;
          map.invalidateSize();
          map.fitBounds(bounds, { padding: [36, 36] });
        });
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [sites]);

  if (failed) return <div className="empty">The map couldn't load. Every site is listed under Projects below.</div>;
  return (
    <div
      ref={el}
      className={`power-map${theme === "dark" ? " power-map--dark" : ""}`}
      role="region"
      aria-label="Map of AI data centers and the gas plants proposed or approved for them in Louisiana"
    />
  );
}
