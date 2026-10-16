// Page addresses. Tabs and areas have real paths ("/ownership/70130/", "/market/jefferson/"),
// which the deploy pre-builds as HTML for search engines (etl/prerender.py, which uses the same
// paths: keep the two in step). Anything else (a property or owner lookup, a comparison) is a
// query on the home page ("/?view=property&q=..."). Old query links for tabs and areas still work.

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

/** The path for a page's parameters, or null when they need a query string. */
export function pathFromParams(params) {
  const view = params.view || "overview";
  const extra = Object.keys(params).filter((k) => k !== "view" && k !== "geo" && params[k] != null && params[k] !== "");
  if (extra.length) return null;
  if (!AREA_VIEWS.has(view)) return TAB_PATHS.has(view) ? `/${view}/` : null;
  const slug = params.geo ? slugFromArea(params.geo) : null;
  if (slug === undefined) return null;
  if (view === "overview") return slug ? `/market/${slug}/` : "/";
  return slug ? `/ownership/${slug}/` : "/ownership/";
}
