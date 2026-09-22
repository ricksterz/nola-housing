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
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`);
  } catch {
    throw new Error(`Can't reach the API at ${BASE_URL}. Is the backend running?`);
  }
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    if (detail.detail) throw new Error(detail.detail);
    throw new Error(
      res.status === 404
        ? "Not found."
        : `The server had a problem (HTTP ${res.status}). Try again in a moment.`
    );
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

// A suggestion/lookup key is always the plain street address — city/state/zip is display-only
// (in `.full`) and never round-tripped into a query, so a full formatted address pasted back
// in (e.g. after picking a suggestion, then hitting Search again) still matches.
function streetOnly(address) {
  return address.split(",")[0].trim().toUpperCase().replace(/\s+/g, " ");
}

export async function suggestAddresses(q) {
  const needle = streetOnly(q);
  if (needle.length < 3) return [];
  if (IS_STATIC) {
    const index = await getAddressIndex();
    const starts = index.filter((a) => a.address.startsWith(needle));
    const contains =
      starts.length >= 8 ? [] : index.filter((a) => !a.address.startsWith(needle) && a.address.includes(needle));
    return [...starts, ...contains].slice(0, 8);
  }
  const r = await get(`/api/property/suggest?q=${encodeURIComponent(q)}`);
  return r.suggestions;
}

export async function getPropertyLookup(address) {
  const needle = streetOnly(address);
  if (IS_STATIC) {
    try {
      return await getStatic(`property/${slugify(needle)}.json`);
    } catch {
      const index = await getAddressIndex();
      const match = index.find((a) => a.address.startsWith(needle)) || index.find((a) => a.address.includes(needle));
      if (match) return getStatic(`property/${match.slug}.json`);
      throw new Error(
        `No assessor record matches "${needle}". Pick an address from the suggestions as you type, or double-check the spelling and street type (Rd/St/Ave/Dr).`
      );
    }
  }
  return get(`/api/property/lookup?address=${encodeURIComponent(needle)}`);
}
