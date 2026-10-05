// Usage counts with GoatCounter (goatcounter.com): free for non-commercial sites, no cookies, no
// personal data, so no consent banner. Off unless the build sets VITE_GOATCOUNTER_CODE (the site's
// GoatCounter code, e.g. "nolaatlas"), and GoatCounter itself ignores localhost.
//
// What's counted is deliberately coarse: which view was opened ("/property", "/ownership") and
// named events from the fixed list below. Never the address, street, owner name or parcel typed,
// and never the page's query string, since that carries what was searched (?q=, ?owner=).

const CODE = import.meta.env.VITE_GOATCOUNTER_CODE;

export const EVENTS = {
  searchAddress: "search-address",
  searchStreet: "search-street",
  searchParcel: "search-parcel",
  searchOwner: "search-owner",
  searchMiss: "search-no-match",
  openBuilding: "open-building",
  filterUnits: "filter-units",
  openOwnerPage: "open-owner-page",
  ownerLinkFromProperty: "owner-link-from-property",
  copyLink: "copy-link",
  googleMaps: "open-google-maps",
  costCalculator: "use-cost-calculator",
  ownershipArea: "ownership-change-area",
  ownershipSort: "ownership-sort-zips",
};
const ALLOWED = new Set(Object.values(EVENTS));

let queue = [];
let loading = false;

function send(vars) {
  if (!CODE) return;
  const gc = window.goatcounter;
  if (gc?.count) {
    gc.count(vars);
    return;
  }
  queue.push(vars);
  if (loading) return;
  loading = true;
  // Counting is driven from here (no_onload), so GoatCounter never reads the page URL itself.
  window.goatcounter = { no_onload: true, ...(window.goatcounter || {}) };
  const s = document.createElement("script");
  s.async = true;
  s.src = "https://gc.zgo.at/count.js";
  s.dataset.goatcounter = `https://${CODE}.goatcounter.com/count`;
  s.dataset.goatcounterSettings = JSON.stringify({ no_onload: true });
  s.onload = () => {
    const pending = queue;
    queue = [];
    for (const v of pending) window.goatcounter?.count?.(v);
  };
  document.head.appendChild(s);
}

/** A view was opened: counted as "/overview", "/property", "/ownership"... */
export function trackView(view) {
  send({ path: `/${view || "overview"}`, title: view || "overview" });
}

const counted = new Set();

/** A named feature was used. ``once`` counts it at most once per page load (sliders, typing). */
export function trackEvent(name, { once = false } = {}) {
  if (!ALLOWED.has(name)) return;
  if (once) {
    if (counted.has(name)) return;
    counted.add(name);
  }
  send({ path: name, title: name, event: true });
}
