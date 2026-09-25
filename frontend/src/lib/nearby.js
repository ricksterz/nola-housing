// Nearby homes for the property map. The static export buckets parcels into NEAR_CELL_DEG grid
// cells (etl/export_static.py's near_key — keep these in sync); this loads only the cells a
// radius around one address touches, then sorts by distance.
export const NEAR_CELL_DEG = 0.005;
export const NEAR_RADIUS_M = 400;
const M_PER_DEG_LAT = 111320;

export function nearKey(lat, lng) {
  return `${Math.floor(lat / NEAR_CELL_DEG)}_${Math.floor(lng / NEAR_CELL_DEG)}`;
}

/** Grid cells a circle of ``radiusM`` around (lat, lng) touches. */
export function cellsAround(lat, lng, radiusM = NEAR_RADIUS_M) {
  const dLat = radiusM / M_PER_DEG_LAT;
  const dLng = radiusM / (M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  const keys = new Set();
  for (const y of [lat - dLat, lat + dLat]) for (const x of [lng - dLng, lng + dLng]) keys.add(nearKey(y, x));
  keys.add(nearKey(lat, lng));
  return [...keys];
}

/** Distance in meters; equirectangular is exact enough at a few hundred meters. */
export function distanceM(lat1, lng1, lat2, lng2) {
  const x = ((lng2 - lng1) * Math.PI) / 180 * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  const y = ((lat2 - lat1) * Math.PI) / 180;
  return Math.sqrt(x * x + y * y) * 6371000;
}

/** Rows ([street, key, lat, lng, assessed, sale, zone]) -> nearest homes within the radius. */
export function nearestHomes(rows, lat, lng, { selfKey, radiusM = NEAR_RADIUS_M, limit = 60 } = {}) {
  const seen = new Set();
  const out = [];
  for (const [street, key, hLat, hLng, assessed, sale, zone] of rows) {
    if (key === selfKey || seen.has(key)) continue;
    seen.add(key);
    const d = distanceM(lat, lng, hLat, hLng);
    if (d <= radiusM) out.push({ street, key, lat: hLat, lng: hLng, assessed, sale, zone, d });
  }
  return out.sort((a, b) => a.d - b.d).slice(0, limit);
}

export function fmtDistance(m) {
  const ft = m * 3.28084;
  return ft < 1000 ? `${Math.round(ft / 10) * 10} ft` : `${(ft / 5280).toFixed(1)} mi`;
}
