// Usage counts with Google Analytics 4. Off unless the build sets VITE_GA_MEASUREMENT_ID, skipped
// on localhost, and skipped for visitors whose browser sends Global Privacy Control.
//
// What Google receives is deliberately coarse: which view was opened ("/property", "/ownership")
// and named events from the fixed list below. Never the address, street, owner name or parcel
// typed, and never the page's real URL, title or referrer, since the URL's query carries what
// was searched (?q=, ?owner=). The tag's own page view is off (send_page_view: false), and every
// hit carries a cleaned page_location. In the GA property, Enhanced measurement's "Page changes
// based on browser history events" and "Site search" should stay off too: both read the real URL.

const ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

export const EVENTS = {
  searchAddress: "search_address",
  searchStreet: "search_street",
  searchParcel: "search_parcel",
  searchOwner: "search_owner",
  searchMiss: "search_no_match",
  openBuilding: "open_building",
  filterUnits: "filter_units",
  openOwnerPage: "open_owner_page",
  ownerLinkFromProperty: "owner_link_from_property",
  copyLink: "copy_link",
  googleMaps: "open_google_maps",
  costCalculator: "use_cost_calculator",
  ownershipArea: "ownership_change_area",
  ownershipSort: "ownership_sort_zips",
};
const ALLOWED = new Set(Object.values(EVENTS));

let started = false;
let currentView = "overview";

function enabled() {
  if (!ID || typeof window === "undefined") return false;
  if (["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) return false;
  return !navigator.globalPrivacyControl;
}

const cleanLocation = (view) => `${window.location.origin}/${view}`;

/** The referrer with no path or query: another site's origin, or nothing for this site. */
function cleanReferrer() {
  try {
    const ref = new URL(document.referrer);
    return ref.origin === window.location.origin ? "" : ref.origin;
  } catch {
    return "";
  }
}

// gtag.js reads queued calls as Arguments objects, not arrays, so this mirrors Google's snippet.
function gtag() {
  window.dataLayer.push(arguments);
}

function start() {
  if (started) return true;
  if (!enabled()) return false;
  started = true;
  window.dataLayer = window.dataLayer || [];
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", ID, {
    send_page_view: false,
    page_location: cleanLocation(currentView),
    page_referrer: cleanReferrer(),
    page_title: currentView,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ID)}`;
  document.head.appendChild(s);
  return true;
}

/** A view was opened: a page view of "/overview", "/property", "/ownership"... */
export function trackView(view) {
  currentView = view || "overview";
  if (!start()) return;
  // Later hits (events) carry the same cleaned location and title.
  gtag("set", { page_location: cleanLocation(currentView), page_title: currentView });
  gtag("event", "page_view", { page_location: cleanLocation(currentView), page_title: currentView });
}

const counted = new Set();

/** A named feature was used. ``once`` counts it at most once per page load (sliders, typing). */
export function trackEvent(name, { once = false } = {}) {
  if (!ALLOWED.has(name)) return;
  if (once) {
    if (counted.has(name)) return;
    counted.add(name);
  }
  if (!start()) return;
  gtag("event", name);
}
