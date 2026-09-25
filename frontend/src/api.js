// In static mode (GitHub Pages / previews) the app reads pre-exported JSON from
// ./data instead of calling the FastAPI backend. Regenerate with:
//   python -m etl.export_static
import { cellsAround } from "./lib/nearby";

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
    if (detail.detail) {
      // A detail is a message, or { message, nearby } for an address with no record.
      const d = detail.detail;
      throw Object.assign(new Error(typeof d === "string" ? d : d.message), d.nearby ? { nearby: d.nearby } : {});
    }
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

export function getOwnershipCosts() {
  if (IS_STATIC) return getStatic("costs.json").catch(() => ({ zips: {} }));
  return get("/api/market/costs").catch(() => ({ zips: {} }));
}

export function getMacroIndex() {
  if (IS_STATIC) return getStatic("macro_index.json").catch(() => ({ series: [] }));
  return get("/api/market/macro_index").catch(() => ({ series: [] }));
}

// A suggestion/lookup key is always the plain street address — city/state/zip is display-only
// (in `.full`) and never round-tripped into a query, so a full formatted address pasted back
// in (e.g. after picking a suggestion, then hitting Search again) still matches.
function streetOnly(address) {
  return address.split(",")[0].trim().toUpperCase().replace(/\s+/g, " ");
}

// The address list (133k+ entries, multiple MB) is sharded by its first 3 characters at build
// time (etl/export_static.py's shard_key — keep these in sync) instead of shipped as one file:
// fetching and linear-scanning the whole thing on every keystroke was crashing the tab on
// phones (large download + repeated full-array scans on a constrained mobile browser).
function shardKey(prefix) {
  return prefix.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function getAddressShard(prefix) {
  return getStatic(`addr/${shardKey(prefix)}.json`).catch(() => []);
}

export async function suggestAddresses(q) {
  const needle = streetOnly(q);
  if (needle.length < 3) return [];
  if (IS_STATIC) {
    const shard = await getAddressShard(needle);
    return shard.filter((a) => a.address.startsWith(needle)).slice(0, 8);
  }
  const r = await get(`/api/property/suggest?q=${encodeURIComponent(q)}`);
  return r.suggestions;
}

/** Raw nearby rows around a point: the grid cells in static mode, a bounding box from the API. */
export async function getNearbyRows(lat, lng) {
  if (IS_STATIC) {
    const cells = await Promise.all(cellsAround(lat, lng).map((k) => getStatic(`near/${k}.json`).catch(() => [])));
    return cells.flat();
  }
  const r = await get(`/api/property/nearby?lat=${lat}&lng=${lng}`);
  return r.homes;
}

// "418 BONNABEL BLVD" -> [418, "BONNABEL BLVD"]; same rule as backend/queries.py split_house_number.
function splitHouseNumber(address) {
  const m = /^(\d+)[A-Z]?(?:-\d+[A-Z]?)?\s+(.+)$/.exec(address);
  return m ? [Number(m[1]), m[2]] : null;
}

// Nearest house numbers first, same side of the street winning ties (queries.closest_on_street).
function closestOnStreet(entries, number, limit = 4) {
  const rank = ([n]) => [Math.abs(n - number), (((n - number) % 2) + 2) % 2, n];
  return [...entries]
    .sort((a, b) => {
      const [x, y] = [rank(a), rank(b)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    })
    .slice(0, limit)
    .map(([, address, full]) => ({ address, full }));
}

// Same wording as backend/queries.py lookup_miss_message.
function lookupMiss(street, nearby) {
  const message = nearby.length
    ? `No Assessor record for "${street}". The Assessor files some homes under a neighboring number or with no street address. Closest on this street:`
    : `No Assessor record matches "${street}". Pick an address from the suggestions as you type, or check the spelling and street type (Rd, St, Ave, Dr).`;
  return Object.assign(new Error(message), { nearby });
}

export async function getPropertyLookup(address) {
  const needle = streetOnly(address);
  if (IS_STATIC) {
    try {
      return await getStatic(`property/${slugify(needle)}.json`);
    } catch {
      const shard = await getAddressShard(needle);
      const match = shard.find((a) => a.address.startsWith(needle)) || shard.find((a) => a.address.includes(needle));
      if (match) return getStatic(`property/${match.slug}.json`);
      const parts = splitHouseNumber(needle);
      const street = parts ? await getStatic(`street/${slugify(parts[1])}.json`).catch(() => []) : [];
      throw lookupMiss(address.split(",")[0].trim(), parts ? closestOnStreet(street, parts[0]) : []);
    }
  }
  return get(`/api/property/lookup?address=${encodeURIComponent(needle)}`);
}
