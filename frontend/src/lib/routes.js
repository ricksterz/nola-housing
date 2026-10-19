// Page addresses. Tabs and areas have real paths ("/ownership/70130/", "/market/jefferson/"),
// which the deploy pre-builds as HTML for search engines (etl/prerender.py, which uses the same
// paths: keep the two in step). Anything else rides as a query on its tab's path: a property
// lookup is "/property/?q=...", an owner page "/ownership/?owner=...". Those paths are also where
// the link-preview Worker runs (cloudflare/link-previews). Old "/?view=..." links still work.

const PARISH_SLUG = { 22051: "jefferson", 22071: "orleans" };
const SLUG_PARISH = { jefferson: "22051", orleans: "22071" };
const TAB_PATHS = new Set(["scorecard", "compare", "macro", "property", "ownership", "about"]);
// Tabs that show one area; elsewhere the area isn't part of the page, so it's left off.
const AREA_VIEWS = new Set(["overview", "ownership"]);

function areaFromSlug(slug) {
  if (/^\d{5}$/.test(slug)) return `zip:${slug}`;
  return SLUG_PARISH[slug] ? `county:${SLUG_PARISH[slug]}` : undefined;
}

// "zip:70130" -> "70130", "county:22051" -> "jefferson", the metro -> null (the default area),
// anything else -> undefined (no path for it).
function slugFromArea(geo) {
  const [level, id] = (geo || "").split(":");
  if (level === "metro") return null;
  if (level === "zip" && /^\d{5}$/.test(id)) return id;
  if (level === "county") return PARISH_SLUG[id];
  return undefined;
}

/** { view, geo } a path stands for; {} for "/" or a path the app doesn't know. */
export function paramsFromPath(pathname) {
  const [first, second] = (pathname || "/").split("/").filter(Boolean);
  if (!first) return {};
  if ((first === "market" || first === "ownership") && second) {
    const geo = areaFromSlug(second);
    return geo ? { view: first === "market" ? "overview" : "ownership", geo } : {};
  }
  return TAB_PATHS.has(first) && !second ? { view: first } : {};
}

/** The URL for a page's parameters: its path, plus any other parameters as a query. Null for a
 * view or area that has no path (the caller falls back to "/?view=..."). */
export function pathFromParams(params) {
  const view = params.view || "overview";
  const extra = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (k !== "view" && k !== "geo" && v != null && v !== "") extra.set(k, v);
  const query = extra.toString() ? `?${extra}` : "";
  if (!AREA_VIEWS.has(view)) return TAB_PATHS.has(view) ? `/${view}/${query}` : null;
  const slug = params.geo ? slugFromArea(params.geo) : null;
  if (slug === undefined) return null;
  if (view === "overview") return `${slug ? `/market/${slug}/` : "/"}${query}`;
  return `${slug ? `/ownership/${slug}/` : "/ownership/"}${query}`;
}
