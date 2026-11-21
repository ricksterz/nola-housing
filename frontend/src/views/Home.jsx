import { useEffect, useState } from "react";
import AddressSearch from "../components/AddressSearch";
import { FloodScene, HousingScene, PowerScene, SchoolsScene } from "../components/HomeScenes";
import { FLOODLENS_URL, SCHOOLS_URL } from "../lib/links";
import { wakeFloodLens } from "../lib/floodlens";
import { EVENTS, trackEvent } from "../lib/metrics";

// The home page leads with the address box: the site's promise is "type any address". Below it,
// four ways to explore by topic, each a large picture, a short description and one way in. The
// market and AI & Power are tabs of this app; FloodLens and School Finder are sister sites opened
// in a new tab.
const PATHS = [
  {
    id: "housing",
    view: "overview",
    href: "/market/",
    kicker: "Homes",
    title: "Prices, rents and who owns what",
    text: "Sale prices, home values, rents and inventory for 24 ZIPs, side by side, and who owns each area.",
    cta: "See the market",
    Scene: HousingScene,
  },
  {
    id: "flood",
    href: FLOODLENS_URL,
    event: EVENTS.openFloodLens,
    kicker: "Flood",
    site: "FloodLens",
    title: "See flood risk beyond the FEMA map",
    text: "A flood score for any address, with the drains, levees and storm surge around it and past insurance claims nearby.",
    cta: "Open FloodLens",
    note: "FloodLens runs on a free host and can take up to a minute to wake up on a first visit.",
    Scene: FloodScene,
  },
  {
    id: "schools",
    href: SCHOOLS_URL,
    event: EVENTS.openSchools,
    kicker: "Schools",
    site: "School Finder",
    title: "Find a school with open seats",
    text: "Every public and private school in Jefferson and Orleans: open seats, your chances of getting in, tuition and the dates that matter.",
    cta: "Open School Finder",
    Scene: SchoolsScene,
  },
  {
    id: "power",
    view: "power",
    href: "/power/",
    kicker: "AI & Power",
    title: "AI data centers and your power bill",
    text: "Meta's AI data center in north Louisiana is bringing new gas plants. See what's approved, what's proposed, when the state votes, and who pays.",
    cta: "Follow the tracker",
    Scene: PowerScene,
  },
];

function PathCard({ path, navigate }) {
  const { Scene } = path;
  const external = !path.view;
  function onClick(e) {
    if (external) {
      trackEvent(path.event);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open a new tab
    e.preventDefault();
    navigate({ view: path.view, geo: null, q: null, street: null, owner: null });
    window.scrollTo({ top: 0 });
  }
  return (
    <a
      className={`path path--${path.id}`}
      href={path.href}
      onClick={onClick}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      aria-labelledby={`path-${path.id}`}
    >
      <div className="path-art">
        <Scene />
      </div>
      <div className="path-body">
        <div className="path-kicker">
          <span className="path-dot" aria-hidden="true" />
          {path.kicker}
          {path.site && <span className="path-site">· {path.site}</span>}
        </div>
        <h2 className="path-title" id={`path-${path.id}`}>
          {path.title}
        </h2>
        <p className="path-text">{path.text}</p>
        <span className="path-cta">
          {path.cta} <span className="path-arrow" aria-hidden="true">{external ? "↗" : "→"}</span>
          {external && <span className="sr-only"> (opens in a new tab)</span>}
        </span>
        {path.note && <span className="path-note">{path.note}</span>}
      </div>
    </a>
  );
}

// Desktop gets the cursor in the box; on a phone that would open the keyboard over the page.
const FINE_POINTER = typeof window !== "undefined" && window.matchMedia?.("(pointer: fine)").matches;

// Streets as examples: they open a street's list of addresses, so no one's home is the demo.
const EXAMPLES = ["Magazine St", "Metairie Rd", "Esplanade Ave"];

export default function Home({ ctx }) {
  const { navigate } = ctx;
  const [text, setText] = useState("");

  // FloodLens sleeps when idle; the address report reads it, so start waking it now.
  useEffect(() => wakeFloodLens(), []);

  function open(patch) {
    navigate({ view: "property", geo: null, q: null, street: null, owner: null, ...patch });
    window.scrollTo({ top: 0 });
  }

  // The same routes Property Lookup takes: a street opens its list, an owner their page, and
  // anything typed is searched there (a street or owner name with no house number included).
  function onPick(a) {
    if (a.kind === "street") open({ street: a.slug });
    else if (a.kind === "owner") open({ view: "ownership", owner: a.slug });
    // `address` is what to look up (a parcel number for a condo unit, the property for a one-record
    // owner); `full` is only the label, which for an owner suggestion is their name.
    else open({ q: a.address });
  }

  return (
    <div className="home">
      <header className="home-hero">
        <h1 className="home-title">Type any New Orleans or Metairie address</h1>
        <p className="home-lede">See who owns it, how it floods, and which schools are near.</p>
        <div className="home-search">
          <AddressSearch value={text} onChange={setText} onPick={onPick} onSubmit={(q) => open({ q: q.trim() })} idPrefix="home" size="large" autoFocus={FINE_POINTER} />
          <div className="home-examples">
            <span>Try a street:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="link-button" onClick={() => open({ q: ex })}>
                {ex}
              </button>
            ))}
          </div>
        </div>
      </header>
      <h2 className="home-section-title">Or explore by topic</h2>
      <nav className="paths" aria-label="Explore by topic">
        {PATHS.map((p) => (
          <PathCard key={p.id} path={p} navigate={navigate} />
        ))}
      </nav>
    </div>
  );
}
