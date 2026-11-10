import { useEffect, useRef, useState } from "react";
import { getPropertyLookup, suggestAddresses } from "../api";
import power from "../data/power.json";
import { floodInfo } from "../lib/flood";
import { FLOODLENS_URL, SCHOOLS_URL, floodLensLink, schoolsLink } from "../lib/links";
import { EVENTS, trackEvent } from "../lib/metrics";
import { daysUntil, utilityFor } from "../lib/power";
import { fmtCompactCurrency } from "../lib/theme";

// The home page is address-first: one search is the page, a real sample report shows what an
// address gets (flood, schools, electricity, home value), and the topics sit in a quiet row
// underneath. Housing and AI & Power are tabs of this app; School Finder and FloodLens are sister
// sites opened in a new tab.

// Two real addresses, one per parish, so the sample shows how the answers differ.
const SAMPLES = [
  { q: "1617 Metairie Rd", label: "1617 Metairie Rd", place: "Metairie" },
  { q: "3000 Magazine St", label: "3000 Magazine St", place: "New Orleans" },
];
const SUGGEST_DEBOUNCE_MS = 150;

// Neighborhood shortcuts to their ZIP's market page. A ZIP is only roughly a neighborhood, so
// the ZIP is shown next to the name.
const HOODS = [
  ["French Quarter", "70116"],
  ["Uptown", "70115"],
  ["Mid-City", "70119"],
  ["Bywater", "70117"],
  ["Lakeview", "70124"],
  ["Gentilly", "70122"],
  ["Algiers", "70114"],
  ["Old Metairie", "70005"],
];

// The city's cast-iron water meter lid: a crescent moon and stars inside a ring. Decoration only.
function WaterMeter() {
  const stars = Array.from({ length: 13 }, (_, i) => {
    const a = (i / 13) * Math.PI * 2 - Math.PI / 2;
    return [32 + Math.cos(a) * 22, 32 + Math.sin(a) * 22];
  });
  return (
    <svg className="nola-meter" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" className="nola-meter-ring" />
      <circle cx="32" cy="32" r="26.5" className="nola-meter-ring nola-meter-ring--in" />
      {stars.map(([x, y]) => (
        <path
          key={`${x.toFixed(1)}-${y.toFixed(1)}`}
          transform={`translate(${x} ${y}) scale(0.16)`}
          d="M0 -10 L2.9 -4 L9.5 -3.1 L4.7 1.5 L5.9 8.1 L0 5 L-5.9 8.1 L-4.7 1.5 L-9.5 -3.1 L-2.9 -4 Z"
          className="nola-meter-star"
        />
      ))}
      <path d="M38 19 A14 14 0 1 0 38 45 A11 11 0 1 1 38 19 Z" className="nola-meter-moon" />
    </svg>
  );
}

// A street name set in the blue-and-white sidewalk tiles found at New Orleans corners.
function StreetTiles({ address }) {
  const street = (address || "").split(",")[0].replace(/^\d+[A-Z]?\s+/i, "").toUpperCase();
  if (!street) return null;
  return (
    <div className="nola-tiles" aria-hidden="true">
      {street.split(" ").map((word, w) => (
        <span className="nola-tiles-word" key={`${word}-${w}`}>
          {[...word].map((ch, i) => (
            <span className="nola-tile" key={i}>
              {ch}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

// Cast-iron gallery railing, as a band along the top of the sample report. Decoration only.
function IronLace() {
  return (
    <svg className="nola-lace" aria-hidden="true" preserveAspectRatio="none">
      <defs>
        <pattern id="nola-lace" width="40" height="44" patternUnits="userSpaceOnUse">
          <path className="nola-lace-rail" d="M0 3H40M0 41H40" />
          <path d="M0 3V41" />
          <circle cx="20" cy="22" r="5.5" />
          <path d="M20 3C13 8 13 14 20 16.5C27 14 27 8 20 3ZM20 41C13 36 13 30 20 27.5C27 30 27 36 20 41Z" />
          <path d="M0 13C8 13 10.5 17 10.5 22C10.5 27 8 31 0 31M40 13C32 13 29.5 17 29.5 22C29.5 27 32 31 40 31" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#nola-lace)" />
    </svg>
  );
}

function AddressSearch({ navigate, meta }) {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function onInput(v) {
    setQ(v);
    setActive(-1);
    clearTimeout(timer.current);
    if (!v.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    const n = ++seq.current;
    timer.current = setTimeout(async () => {
      const results = await suggestAddresses(v).catch(() => []);
      if (n !== seq.current) return; // a newer keystroke superseded this one
      setSuggestions(results);
      setOpen(results.length > 0);
    }, SUGGEST_DEBOUNCE_MS);
  }

  function go(text) {
    const t = text.trim();
    if (!t) return;
    trackEvent(EVENTS.hubSearch);
    navigate({ view: "property", q: t, street: null, owner: null });
  }

  function pick(a) {
    setOpen(false);
    trackEvent(EVENTS.hubSearch);
    if (a.kind === "street") navigate({ view: "property", street: a.slug, q: null, owner: null });
    else if (a.kind === "owner") navigate({ view: "ownership", owner: a.slug, q: null, street: null });
    else navigate({ view: "property", q: a.address, street: null, owner: null });
  }

  function onKeyDown(e) {
    if (!open || !suggestions.length) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + suggestions.length) % suggestions.length);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter" && active >= 0) {
      e.preventDefault();
      pick(suggestions[active]);
    }
  }

  return (
    <form
      className="home-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        go(q);
      }}
    >
      <div className="home-eyebrow">
        <WaterMeter />
        <span>Where y'at?</span>
      </div>
      <label className="home-search-label" htmlFor="home-q">
        Look up any address in New Orleans and Metairie.
      </label>
      <div className="home-search-row">
        <div className="search-box">
          <input
            id="home-q"
            className="search-input home-search-input"
            value={q}
            onChange={(e) => onInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onKeyDown}
            placeholder="Street address, e.g. 1617 Metairie Rd"
            role="combobox"
            aria-expanded={open}
            aria-controls="home-suggestions"
            aria-activedescendant={active >= 0 ? `home-suggestion-${active}` : undefined}
            autoComplete="off"
            maxLength={200}
          />
          {open && (
            <div className="suggestions" id="home-suggestions" role="listbox">
              {suggestions.map((a, i) => (
                <div
                  key={`${a.kind || "address"}-${a.address || a.slug}`}
                  id={`home-suggestion-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={`suggestion${i === active ? " suggestion--active" : ""}`}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(a);
                  }}
                >
                  <span>{a.full}</span>
                  {a.sub && <span className="suggestion-sub">{a.sub}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <button className="btn-primary home-search-btn" type="submit">
          Look up
        </button>
      </div>
      <div className="home-search-note">
        {meta?.property_count ? `${meta.property_count.toLocaleString()} parcels and condo units` : "Every parcel"} in
        Jefferson and Orleans Parish. Street names, owner names and parcel numbers work too.
      </div>
    </form>
  );
}

function ReportRow({ k, value, sub, action }) {
  return (
    <div className="report-row">
      <div className="report-k">{k}</div>
      <div className="report-v">
        <div className="report-value">{value}</div>
        {sub && <div className="report-sub">{sub}</div>}
      </div>
      <div className="report-action">{action}</div>
    </div>
  );
}

function SampleReport({ navigate }) {
  const [i, setI] = useState(0);
  const [docs, setDocs] = useState({});
  const sample = SAMPLES[i];
  const loaded = sample.q in docs;
  const p = docs[sample.q] || null;

  useEffect(() => {
    if (loaded) return;
    let cancelled = false;
    getPropertyLookup(sample.q)
      .then((d) => !cancelled && setDocs((m) => ({ ...m, [sample.q]: d?.parcel || null })))
      .catch(() => !cancelled && setDocs((m) => ({ ...m, [sample.q]: null })));
    return () => {
      cancelled = true;
    };
  }, [sample.q, loaded]);

  const flood = p && floodInfo(p);
  const u = p && utilityFor(p.parish);
  const zip = p?.zip_code;

  return (
    <section className="report" aria-labelledby="report-title">
      <IronLace />
      <div className="report-head">
        <div>
          <div className="report-kicker">What every address gets · sample</div>
          <StreetTiles address={p?.full_address || sample.label} />
          <h2 className="report-title" id="report-title">
            {p?.full_address || sample.label}
          </h2>
        </div>
        <div className="report-tabs" role="tablist" aria-label="Sample address">
          {SAMPLES.map((s, n) => (
            <button key={s.q} type="button" role="tab" aria-selected={n === i} className={`report-tab${n === i ? " is-on" : ""}`} onClick={() => setI(n)}>
              {s.place}
            </button>
          ))}
        </div>
      </div>

      {!loaded ? (
        <div className="report-loading" aria-live="polite">
          Loading the sample report…
        </div>
      ) : !p ? (
        <div className="report-loading">The sample couldn't load. Search any address above to see its report.</div>
      ) : (
        <div className="report-rows">
          {flood && (
            <ReportRow
              k="Flood risk"
              value={flood.title}
              sub={`FEMA zone ${p.flood_zone}`}
              action={
                <a href={floodLensLink(p.full_address)} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openFloodLens)}>
                  Drainage, levees, surge ↗
                </a>
              }
            />
          )}
          {zip && (
            <ReportRow
              k="Schools"
              value={`Public and private schools near ${zip}`}
              sub="Open seats, chances of getting in, tuition"
              action={
                <a href={schoolsLink(zip)} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openSchools)}>
                  School Finder ↗
                </a>
              }
            />
          )}
          {u && (
            <ReportRow
              k="Electricity"
              value={u.utility}
              sub={`Rates set by the ${u.regulator}`}
              action={
                <button type="button" className="link-button" onClick={() => navigate({ view: "power" })}>
                  AI &amp; Power →
                </button>
              }
            />
          )}
          {p.zhvi && zip && (
            <ReportRow
              k="Home values"
              value={`${fmtCompactCurrency(p.zhvi)} typical home in ${zip}`}
              sub="Zillow Home Value Index"
              action={
                <button type="button" className="link-button" onClick={() => navigate({ view: "overview", geo: `zip:${zip}` })}>
                  {zip} market →
                </button>
              }
            />
          )}
        </div>
      )}

      <div className="report-foot">
        <span>
          <b className="nola-lagniappe">Lagniappe:</b> the owner, assessed value, monthly cost, sales and the homes nearby.
        </span>
        <button type="button" className="btn report-open" onClick={() => navigate({ view: "property", q: sample.q, street: null, owner: null })}>
          Open the full report →
        </button>
      </div>
    </section>
  );
}

export default function Home({ ctx }) {
  const { meta, navigate } = ctx;
  const vote = power.nextVote;
  const days = vote ? daysUntil(vote.date) : -1;
  const tab = (view) => (e) => {
    e.preventDefault();
    navigate({ view });
  };

  return (
    <div className="home">
      <AddressSearch navigate={navigate} meta={meta} />
      <SampleReport navigate={navigate} />

      <nav className="home-hoods" aria-label="Neighborhoods">
        <span className="home-explore-k">Wander a neighborhood</span>
        {HOODS.map(([name, zip]) => (
          <a
            key={zip}
            className="home-hood"
            href={`/market/${zip}/`}
            onClick={(e) => {
              e.preventDefault();
              navigate({ view: "overview", geo: `zip:${zip}` });
            }}
          >
            {name} <span className="home-hood-zip">{zip}</span>
          </a>
        ))}
      </nav>

      <nav className="home-explore" aria-label="Explore by topic">
        <span className="home-explore-k">Or explore</span>
        <a href="/market/" onClick={tab("overview")}>
          Housing market
        </a>
        <a href="/scorecard/" onClick={tab("scorecard")}>
          ZIP Scorecard
        </a>
        <a href="/ownership/" onClick={tab("ownership")}>
          Who owns what
        </a>
        <a href={SCHOOLS_URL} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openSchools)}>
          Schools ↗
        </a>
        <a href={FLOODLENS_URL} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openFloodLens)}>
          Flood risk ↗
        </a>
        <a href="/power/" onClick={tab("power")}>
          AI &amp; Power
        </a>
      </nav>

      {days >= 0 && (
        <a className="home-latest" href="/power/" onClick={tab("power")}>
          <span className="home-latest-dot" aria-hidden="true" />
          <span className="home-latest-k">Coming up</span>
          <span className="home-latest-text">
            The state is expected to vote on seven more gas plants for Meta's AI data center in about {days} day{days === 1 ? "" : "s"}.
          </span>
          <span className="home-latest-go">Follow it →</span>
        </a>
      )}
    </div>
  );
}
