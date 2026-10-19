// What a shared lookup link's preview should say. Pure functions over the site's own static
// data (/data/...), so they're testable without Cloudflare; index.js fetches and rewrites.
//
// Lookups are queries on their tab's page, so link previewers (which don't run JavaScript) would
// otherwise show the tab's card for every property:
//   /property/?q=1 Poydras St, New Orleans, LA 70130          a property, by address
//   /property/?q=Parcel 103109601                             a property or unit, by parcel/tax bill
//   /ownership/?owner=housing-authority-of-new-orleans        an owner page (also /ownership/{area}/)
// Older links put them on the home page ("/?view=property&q=..."); those are read the same way.
// The lookup rules are the app's (frontend/src/api.js): keep them in step.

export const SITE = "https://nolaatlas.com";
const TAIL = "Flood risk, the true monthly cost and the market around it, on NOLA Atlas.";

// Same result as the app's slugify, with the ends trimmed by index rather than a /^-+|-+$/
// pattern, which backtracks badly on a crafted run of dashes (the input here is the shared URL).
export function slugify(text) {
  const s = String(text).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let start = 0;
  let end = s.length;
  while (start < end && s[start] === "-") start++;
  while (end > start && s[end - 1] === "-") end--;
  return s.slice(start, end);
}
const MAX_QUERY = 200; // longer than any address or owner slug; anything longer isn't a lookup
// etl/export_static.py shard_key and pid_key.
const shardKey = (addr) => addr.slice(0, 3).toUpperCase().replace(/[^A-Z0-9]/g, "_");
const pidKey = (id) => slugify(id.slice(0, 7)) || "_";

/** "Parcel 103109601", "103109601", "0820008042a" -> the ID; null for an address. */
export function parcelQuery(q) {
  const m = String(q || "").toUpperCase().replace(/[\s#-]/g, "").match(/^(?:PARCEL)?(\d{7,}[A-Z]{0,2})$/);
  return m ? m[1] : null;
}

/** The street part of a typed address, as the address index writes it: "1 POYDRAS ST". */
export function streetOf(q) {
  return String(q || "").split(",")[0].toUpperCase().replace(/\s+/g, " ").trim();
}

const money = (v) => `$${Math.round(v).toLocaleString("en-US")}`;
const zipOf = (full) => (String(full || "").match(/\bLA (\d{5})\b/) || [])[1];

function areaImage(zip, zips) {
  return zip && zips.has(zip) ? `${SITE}/og/market-${zip}.png` : `${SITE}/og/property.png`;
}

/** Preview text for a property page document (a parcel or a condo building). */
export function describeProperty(doc, zips) {
  // A building's page lists its units; a unit's page has its own record plus a link to the building.
  if (doc.building && !doc.parcel) {
    const b = doc.building;
    const street = b.full.split(",")[0];
    return {
      title: `${b.full} · NOLA Atlas`,
      description: `${b.units.length.toLocaleString("en-US")} condo units on record at ${street}: each unit's owner, tax bill and flood zone. ${TAIL}`,
      image: areaImage(zipOf(b.full), zips),
      imageAlt: `${street} on NOLA Atlas`,
    };
  }
  const p = doc.parcel || {};
  let place = p.full_address || (p.parcel_id ? `Parcel ${p.parcel_id}` : "A property");
  // A unit the roll doesn't number reads like its building: say which tax bill it is.
  if (doc.building && p.full_address === doc.building.full && p.tax_bill_number) place += ` (tax bill ${p.tax_bill_number})`;
  const facts = [];
  if (p.flood_zone) facts.push(`Flood zone ${p.flood_zone}${p.flood_sfha ? " (high risk)" : ""}`);
  if (p.assessed_val) facts.push(`assessed at ${money(p.assessed_val)}`);
  if (p.last_sale_price && p.last_sale_date) facts.push(`last sold for ${money(p.last_sale_price)} in ${String(p.last_sale_date).slice(0, 4)}`);
  if (p.year_built) facts.push(`built ${p.year_built}`);
  if (p.land_area) facts.push(`lot ${Math.round(p.land_area).toLocaleString("en-US")} sq ft`);
  const lead = facts.length ? `${facts.join(", ")}. ` : "";
  return {
    title: `${place} · NOLA Atlas`,
    description: `${lead}${TAIL}`,
    image: areaImage(p.zip_code || zipOf(place), zips),
    imageAlt: `${place.split(",")[0]} on NOLA Atlas`,
  };
}

/** Preview text for an owner page document (/data/owner/{slug}.json). */
export function describeOwner(o) {
  const parishes = Object.keys(o.parishes || {})
    .map((p) => (p === "jefferson" ? "Jefferson" : "Orleans"))
    .join(" and ");
  return {
    title: `${o.name} · ${o.count.toLocaleString("en-US")} properties · NOLA Atlas`,
    description: `${o.count.toLocaleString("en-US")} properties on the ${parishes} Parish Assessor's roll${parishes.includes(" and ") ? "s" : ""} under ${o.name}, on a map with flood zones. Owner names are shown as published in public records.`,
    image: `${SITE}/og/ownership.png`,
    imageAlt: `${o.name} on NOLA Atlas`,
  };
}

/**
 * The preview for a request URL, or null to leave the page as it is. ``get(path)`` returns the
 * parsed JSON at a site path, or null when it isn't there.
 */
export async function previewFor(url, get) {
  const p = url.searchParams;
  const view = p.get("view") || (url.pathname.startsWith("/property/") ? "property" : url.pathname.startsWith("/ownership/") ? "ownership" : null);
  if (view === "ownership" && p.get("owner")) {
    const slug = p.get("owner");
    if (!/^[a-z0-9-]{1,90}$/.test(slug)) return null;
    const owner = await get(`/data/owner/${slug}.json`);
    return owner ? describeOwner(owner) : null;
  }
  const q = p.get("q");
  if (view !== "property" || !q || q.length > MAX_QUERY) return null;
  let doc = null;
  const pid = parcelQuery(q);
  if (pid) {
    const hit = ((await get(`/data/pid/${pidKey(pid)}.json`)) || []).find((r) => r[0] === pid);
    if (hit) doc = await get(`/data/property/${hit[1]}.json`);
  } else {
    const street = streetOf(q);
    if (!street) return null;
    doc = await get(`/data/property/${slugify(street)}.json`);
    if (!doc) {
      const hit = ((await get(`/data/addr/${shardKey(street)}.json`)) || []).find((a) => a.address === street && !a.parcel);
      if (hit) doc = await get(`/data/property/${hit.slug}.json`);
    }
  }
  if (!doc) return null;
  const meta = (await get("/data/meta.json")) || {};
  const zips = new Set((meta.geos || []).filter((g) => g.geo_level === "zip").map((g) => g.geo_id));
  return describeProperty(doc, zips);
}
