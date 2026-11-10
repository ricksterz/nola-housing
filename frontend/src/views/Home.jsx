import { FloodScene, HousingScene, PowerScene, SchoolsScene } from "../components/HomeScenes";
import { FLOODLENS_URL, SCHOOLS_URL } from "../lib/links";
import { EVENTS, trackEvent } from "../lib/metrics";

// The home page is a landing spot with four paths: a large picture, a short description and one
// way in for each. Homes and AI & Power are tabs of this app; School Finder and FloodLens are
// sister sites opened in a new tab. Nothing else competes with the four choices.
const PATHS = [
  {
    id: "housing",
    view: "overview",
    href: "/market/",
    kicker: "Homes",
    title: "What homes cost, and who owns them",
    text: "Prices, rents and sales for every ZIP, plus a report on any address: its owner, assessed value, flood zone and the true monthly cost to own.",
    cta: "Explore homes",
    Scene: HousingScene,
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
    id: "flood",
    href: FLOODLENS_URL,
    event: EVENTS.openFloodLens,
    kicker: "Flood",
    site: "FloodLens",
    title: "See flood risk beyond the FEMA map",
    text: "A flood score for any address, with the drains, levees and storm surge around it and past insurance claims nearby.",
    cta: "Open FloodLens",
    Scene: FloodScene,
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
      </div>
    </a>
  );
}

export default function Home({ ctx }) {
  return (
    <div className="home">
      <header className="home-hero">
        <h1 className="home-title">Where would you like to start?</h1>
        <p className="home-lede">Four guides to living in New Orleans and Metairie, built on public records.</p>
      </header>
      <nav className="paths" aria-label="Choose a topic">
        {PATHS.map((p) => (
          <PathCard key={p.id} path={p} navigate={ctx.navigate} />
        ))}
      </nav>
    </div>
  );
}
