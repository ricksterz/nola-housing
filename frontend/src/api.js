// In static mode (GitHub Pages / previews) the app reads pre-exported JSON from
// ./data instead of calling the FastAPI backend. Regenerate with:
//   python -m etl.export_static
export const IS_STATIC = import.meta.env.VITE_STATIC_DATA === "true";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";
const DATA_BASE = `${import.meta.env.BASE_URL}data`;

function slugify(address) {
  return address.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

const cache = new Map();
async function getStatic(file, missingMessage) {
  if (cache.has(file)) return cache.get(file);
  const p = fetch(`${DATA_BASE}/${file}`).then(async (res) => {
    if (!res.ok) throw new Error(missingMessage || `Failed to load ${file} (${res.status})`);
    return res.json();
  });
  cache.set(file, p);
  p.catch(() => cache.delete(file));
  return p;
}

export function getMeta() {
  if (IS_STATIC) return getStatic("meta.json").catch(() => null);
  return get("/api/meta").catch(() => null);
}

export function getTrend(geo_level, geo_id) {
  if (IS_STATIC) return getStatic(`trend_${geo_level}_${geo_id}.json`);
  return get(`/api/market/trend?geo_level=${geo_level}&geo_id=${encodeURIComponent(geo_id)}`);
}

export function getCompare() {
  if (IS_STATIC) return getStatic("compare.json");
  return get("/api/market/compare");
}

export function getScorecard() {
  if (IS_STATIC) return getStatic("scorecard.json");
  return get("/api/market/scorecard");
}

export function getMacroSnapshot() {
  if (IS_STATIC) return getStatic("macro.json").catch(() => ({}));
  return get("/api/macro/snapshot").catch(() => ({}));
}

export function getMacroIndex() {
  if (IS_STATIC) return getStatic("macro_index.json").catch(() => ({ series: [] }));
  return get("/api/market/macro_index").catch(() => ({ series: [] }));
}

let addressIndexPromise = null;
export function getAddressIndex() {
  if (!addressIndexPromise) addressIndexPromise = getStatic("addresses.json").catch(() => []);
  return addressIndexPromise;
}

export async function suggestAddresses(q) {
  const needle = q.trim().toUpperCase().replace(/\s+/g, " ");
  if (needle.length < 3) return [];
  if (IS_STATIC) {
    const index = await getAddressIndex();
    const starts = index.filter((a) => a.startsWith(needle));
    const contains = starts.length >= 8 ? [] : index.filter((a) => !a.startsWith(needle) && a.includes(needle));
    return [...starts, ...contains].slice(0, 8);
  }
  const r = await get(`/api/property/suggest?q=${encodeURIComponent(q)}`);
  return r.suggestions;
}

export async function getPropertyLookup(address) {
  if (IS_STATIC) {
    const needle = address.trim().toUpperCase().replace(/\s+/g, " ");
    try {
      return await getStatic(`property/${slugify(address)}.json`);
    } catch {
      const index = await getAddressIndex();
      const match = index.find((a) => a.startsWith(needle)) || index.find((a) => a.includes(needle));
      if (match) return getStatic(`property/${slugify(match)}.json`);
      throw new Error(`No assessor record found for '${address.trim()}'`);
    }
  }
  return get(`/api/property/lookup?address=${encodeURIComponent(address)}`);
}
