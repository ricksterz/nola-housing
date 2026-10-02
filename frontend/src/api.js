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
// Units: "apt 11B", "unit 122", "#203", "ste D" anywhere in what's typed (people put them after
// the ZIP too), or a bare token after the street type ("600 Port of New Orleans Pl 11B"). Same
// rules as backend/queries.py split_unit.
const STREET_TYPES = "ST|AVE|AV|BLVD|BL|DR|RD|LN|PL|CT|WAY|HWY|PKWY|PKY|CIR|TER|ROW|SQ|WALK|LOOP|TRCE|PLZ|CV|EXPY|PT|XING|ALY|TRL|BND|PATH";
const UNIT_WORD = /\s*(?:\b(?:UNIT|APT|APARTMENT|STE|SUITE)\b\.?|#)\s*([A-Z0-9][A-Z0-9-]*)/;
const BARE_UNIT = new RegExp(`^(\\d+[A-Z]?\\s.*\\b(?:${STREET_TYPES})\\b)\\s+([A-Z]?\\d+[A-Z]?(?:-\\d*[A-Z]?)?)$`);
const isUnitToken = (t) => /\d/.test(t) || /^[A-Z]$/.test(t);

/** "600 Port of New Orleans Pl, New Orleans, LA 70130 apt 11B" -> { street: "600 PORT OF NEW ORLEANS PL", unit: "11B" } */
export function parseAddress(q) {
  let text = (q || "").toUpperCase().replace(/\s+/g, " ").trim();
  let unit = null;
  const m = UNIT_WORD.exec(text);
  if (m && m.index > 0 && isUnitToken(m[1])) {
    unit = m[1];
    text = `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`.replace(/\s+/g, " ").trim();
  }
  let street = text.split(",")[0].trim();
  if (!unit) {
    const b = BARE_UNIT.exec(street);
    if (b) [street, unit] = [b[1], b[2]];
  }
  return { street, unit };
}

const normUnit = (u) => String(u || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");

function streetOnly(address) {
  return parseAddress(address).street;
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

// A parcel number typed as a search: 7+ digits (house numbers stop at 5), optionally written
// "Parcel 0820015268" or with dashes. Same rule as backend/queries.py parcel_query.
export function parcelQuery(q) {
  // Read before unit parsing, so "Parcel #0820015268" isn't taken for unit "0820015268". Some
  // Jefferson parcel numbers end in a letter ("0820008042A").
  const m = /^(?:PARCEL)?(\d{7,}[A-Z]{0,2})$/.exec((q || "").split(",")[0].toUpperCase().replace(/[\s#-]/g, ""));
  return m ? m[1] : null;
}

// Parcel-number index files are keyed by the first 7 characters (etl/export_static.py pid_key).
function getPidShard(pid) {
  return getStatic(`pid/${slugify(pid.slice(0, 7)) || "_"}.json`).catch(() => []);
}

// [[slug, name, parcels, cities, street], ...], busiest street first; loaded once, only when a
// search starts with a letter.
let streetIndex = null;
function getStreetIndex() {
  if (!streetIndex) {
    streetIndex = (IS_STATIC ? getStatic("streets.json") : get("/api/property/streets").then((r) => r.streets)).catch((e) => {
      streetIndex = null;
      throw e;
    });
  }
  return streetIndex;
}

/** Streets whose words start with every word typed: "bonn" -> Bonnabel Blvd, "n caus" -> N Causeway Blvd. */
export async function suggestStreets(q, limit = 6) {
  const words = streetOnly(q).split(" ").filter(Boolean);
  if (!words.length) return [];
  const index = await getStreetIndex().catch(() => []);
  const out = [];
  for (const [slug, name, count, cities, street] of index) {
    const parts = street.split(" ");
    if (words.every((w) => parts.some((p) => p.startsWith(w)))) {
      out.push({ kind: "street", slug, address: street, full: name, sub: `${count.toLocaleString()} parcels${cities ? ` · ${cities}` : ""}` });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/** Every parcel on one street, for the street list: { slug, name, count, cities, entries: [[number, address, full]] }. */
export async function getStreet(slug) {
  const index = await getStreetIndex();
  const row = index.find((r) => r[0] === slug);
  if (!row) throw new Error("That street isn't in the Assessor's records. Try searching for it again.");
  const entries = IS_STATIC
    ? await getStatic(`street/${slug}.json`)
    : (await get(`/api/property/street?name=${encodeURIComponent(row[4])}`)).entries;
  return { slug, name: row[1], count: row[2], cities: row[3], entries };
}

/**
 * Suggestions while typing: a parcel number suggests parcels, a leading house number suggests
 * addresses, and anything else suggests streets. Each has ``address`` (what to look up) and
 * ``full`` (what to show), plus ``kind`` and an optional ``sub`` line.
 */
export async function suggestAddresses(q) {
  const pid = parcelQuery(q);
  if (pid) {
    if (!IS_STATIC) {
      const r = await get(`/api/property/suggest?q=${encodeURIComponent(pid)}`);
      return r.suggestions.map((a) => ({ kind: "parcel", address: a.address, full: a.full.split(" · ")[0], sub: a.full.split(" · ").slice(1).join(" · ") }));
    }
    const shard = await getPidShard(pid);
    return shard
      .filter(([id]) => id.startsWith(pid))
      .slice(0, 8)
      .map(([id, , label, kind]) => ({ kind: "parcel", address: id, full: `${kind === "bill" ? "Tax bill" : "Parcel"} ${id}`, sub: label }));
  }
  const needle = streetOnly(q);
  if (needle.length < 3) return [];
  if (!/^\d/.test(needle)) return suggestStreets(needle);
  if (IS_STATIC) {
    const { unit } = parseAddress(q);
    const shard = await getAddressShard(needle);
    // Buildings first, then their units in order; a unit typed narrows to matching units.
    const rank = (a) => (a.units ? 0 : a.unit ? 2 : 1);
    let hits = shard.filter((a) => a.address.startsWith(needle));
    if (unit) hits = hits.filter((a) => a.unit && normUnit(a.unit).startsWith(normUnit(unit)));
    return hits
      .sort((a, b) => a.address.localeCompare(b.address) || rank(a) - rank(b) || naturalCompare(a.unit, b.unit))
      .slice(0, 8)
      .map((a) => {
        if (a.units) return { ...a, sub: `${a.units} unit${a.units === 1 ? "" : "s"} on record` };
        // A unit or a second parcel at an address carries its parcel ID: look that up.
        if (a.parcel) return { ...a, address: a.parcel, sub: a.unit ? null : `Parcel ${a.parcel}` };
        return a;
      });
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

/** "Tax bill 103109611 · Steeg Robert M" for a unit the roll doesn't number. */
export function unitRecordLabel(u) {
  const owner = (u.owner || "").replace(/\s*,\s*/g, ", ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  return [u.tax_bill ? `Tax bill ${u.tax_bill}` : `Parcel ${u.parcel_id}`, owner].filter(Boolean).join(" · ");
}

function naturalCompare(a, b) {
  return String(a || "").localeCompare(String(b || ""), undefined, { numeric: true, sensitivity: "base" });
}

/** One unit of a building: its own page, or a miss listing the units that are on record. */
async function unitInBuilding(doc, unit) {
  const { building } = doc;
  const hit = building.units.find((u) => u.unit && normUnit(u.unit) === normUnit(unit));
  if (hit) return getPropertyLookup(`Parcel ${hit.parcel_id}`);
  const street = building.full.split(",")[0];
  const numbered = building.units.filter((u) => u.unit);
  if (!numbered.length) {
    // Orleans lists condo units as records on one lot with no unit numbers: open the building,
    // where every record is listed by owner and tax bill, and say why the unit wasn't matched.
    return { ...doc, notice: `The City's records don't number the units at ${street}, so unit ${unit} can't be matched directly. Pick yours by owner or tax bill below.` };
  }
  throw Object.assign(new Error(`No unit ${unit} on record at ${street}. Units on record:`), {
    nearby: numbered.slice(0, 12).map((u) => ({ address: `Parcel ${u.parcel_id}`, label: `Unit ${u.unit}` })),
  });
}

export async function getPropertyLookup(address) {
  const pid = parcelQuery(address);
  if (pid) {
    if (!IS_STATIC) return get(`/api/property/lookup?address=${encodeURIComponent(pid)}`);
    const hit = (await getPidShard(pid)).find(([id]) => id === pid);
    if (hit) return getStatic(`property/${hit[1]}.json`);
    throw new Error(`No parcel or tax bill numbered ${pid}. Jefferson parcel numbers are 10 digits; Orleans tax bills are 9.`);
  }
  const { street: needle, unit } = parseAddress(address);
  if (IS_STATIC) {
    let doc = await getStatic(`property/${slugify(needle)}.json`).catch(() => null);
    if (!doc) {
      const shard = await getAddressShard(needle);
      const match = shard.find((a) => a.address.startsWith(needle) && !a.parcel) || shard.find((a) => a.address.includes(needle) && !a.parcel);
      if (match) doc = await getStatic(`property/${match.slug}.json`);
    }
    if (doc?.building && unit) return unitInBuilding(doc, unit);
    if (doc) return doc;
    const parts = splitHouseNumber(needle);
    const street = parts ? await getStatic(`street/${slugify(parts[1])}.json`).catch(() => []) : [];
    throw lookupMiss(address.split(",")[0].trim(), parts ? closestOnStreet(street, parts[0]) : []);
  }
  return get(`/api/property/lookup?address=${encodeURIComponent(needle)}`);
}
