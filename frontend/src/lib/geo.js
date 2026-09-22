// Geography helpers. The authoritative list comes from meta.json (exported by the
// ETL); these constants only shape the UI when meta has not loaded yet.
export const PARISHES = {
  jefferson: { key: "jefferson", label: "Metairie & East Jefferson", short: "Metairie", fips: "22051" },
  orleans: { key: "orleans", label: "New Orleans", short: "New Orleans", fips: "22071" },
};
export const METRO = { geo_level: "metro", geo_id: "35380", name: "New Orleans–Metairie metro" };

export function parseGeo(s) {
  if (!s) return null;
  const [level, id] = s.split(":");
  return level && id ? { geo_level: level, geo_id: id } : null;
}

export function geoKey(g) {
  return `${g.geo_level}:${g.geo_id}`;
}

export function geoLabel(g, geos) {
  const found = geos?.find((x) => x.geo_level === g.geo_level && x.geo_id === g.geo_id);
  if (g.geo_level === "zip") return `${g.geo_id}${found?.name ? ` · ${found.name}` : ""}`;
  return found?.name || g.geo_id;
}
