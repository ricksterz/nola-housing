import { useEffect, useMemo, useState } from "react";
import { getMacroSnapshot, getMeta, getScorecard, IS_STATIC } from "./api";
import ErrorBoundary from "./components/ErrorBoundary";
import { EVENTS, trackEvent, trackView } from "./lib/metrics";
import { FLOODLENS_URL, SCHOOLS_URL } from "./lib/links";
import { geoLabel, parseGeo } from "./lib/geo";
import { paramsFromPath, pathFromParams } from "./lib/routes";
import Footer from "./components/Footer";
import MacroStrip from "./components/MacroStrip";
import About from "./views/About";
import Compare from "./views/Compare";
import Home from "./views/Home";
import Macro from "./views/Macro";
import Overview from "./views/Overview";
import Ownership from "./views/Ownership";
import Power from "./views/Power";
import Property from "./views/Property";
import Scorecard from "./views/Scorecard";

const VIEWS = [
  ["home", "Home"],
  ["overview", "Market Overview"],
  ["scorecard", "ZIP Scorecard"],
  ["compare", "Compare"],
  ["macro", "Macro"],
  ["property", "Property Lookup"],
  ["ownership", "Ownership"],
  ["power", "AI & Power"],
  ["about", "About"],
];
// The housing snapshot strip belongs to the housing tabs, not the hub or the power tracker.
const NO_STRIP = new Set(["home", "power"]);

const SITE = "https://nolaatlas.com";
const DEFAULT_TITLE = "NOLA Atlas — Every address in New Orleans and Metairie, explained";

// Title and canonical URL per view, so search engines index each tab and area as its own page
// (the paths etl/prerender.py builds). Only view and area count: a searched address, street or
// owner (q, street, owner) never goes in the canonical URL or the title, so property and owner
// pages fold into their tab's page.
function pageMeta(view, url, geos) {
  const geo = parseGeo(url.geo);
  const area = geo ? geoLabel(geo, geos) : null;
  const titles = {
    home: null,
    overview: area ? `${area} housing market` : "Housing market",
    scorecard: "ZIP Scorecard",
    compare: "Compare areas",
    macro: "Macro trends",
    property: "Property Lookup",
    ownership: url.owner ? "Owner" : area ? `Who owns ${area}` : "Who owns New Orleans and Metairie",
    power: "AI data centers and power in Louisiana",
    about: "About and methodology",
  };
  const canonicalGeo = view === "overview" || (view === "ownership" && !url.owner) ? url.geo : undefined;
  const path = pathFromParams({ view, geo: canonicalGeo }) || pathFromParams({ view }) || "/"; // no query: just the tab or area
  return { title: titles[view] ? `${titles[view]} · NOLA Atlas` : DEFAULT_TITLE, canonical: `${SITE}${path}` };
}

// Navigation state: the path's view and area ("/ownership/70130/"), then the query on top.
function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return { ...paramsFromPath(window.location.pathname), ...Object.fromEntries(p.entries()) };
}

export default function App() {
  const [url, setUrl] = useState(readUrl);
  // No view is the hub; an old home-page link with only an area ("/?geo=zip:70130") is a market page.
  const view = VIEWS.some(([v]) => v === url.view) ? url.view : url.geo ? "overview" : "home";
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");
  const [meta, setMeta] = useState(null);
  const [macro, setMacro] = useState(null);
  const [scorecard, setScorecard] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);

  useEffect(() => {
    const { title, canonical } = pageMeta(view, url, meta?.geos);
    document.title = title;
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonical);
  }, [view, url, meta?.geos]);

  // One count per view opened, by view name only (lib/metrics.js).
  useEffect(() => {
    trackView(view);
  }, [view]);

  useEffect(() => {
    getMeta().then(setMeta);
    getMacroSnapshot().then(setMacro);
    getScorecard()
      .then(setScorecard)
      .catch((e) => setError(e.message));
    const onPop = () => setUrl(readUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // URL is the single source of truth for navigation state (view, geo, compare set...).
  function navigate(patch, { replace = false } = {}) {
    const next = { ...readUrl(), ...patch };
    for (const k of Object.keys(next)) if (next[k] == null || next[k] === "") delete next[k];
    const qs = new URLSearchParams(next).toString();
    const href = pathFromParams(next) || (qs ? `/?${qs}` : "/");
    if (replace) history.replaceState(null, "", href);
    else history.pushState(null, "", href);
    setUrl(next);
  }

  // The title is the way home: clear every view, area and search, and start at the top.
  function goHome(e) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // let the browser open a new tab
    e.preventDefault();
    history.pushState(null, "", "/");
    setUrl({});
    window.scrollTo({ top: 0 });
  }

  // The site name is the page's h1 except on home, whose h1 is its own question.
  const Brand = view === "home" ? "div" : "h1";
  const geos = meta?.geos || null;
  const ctx = useMemo(
    () => ({ theme, meta, geos, macro, scorecard, navigate, url }),
    [theme, meta, geos, macro, scorecard, url]
  );

  return (
    <div className="app-shell">
      {/* A slim bar on every page: the name (the way home), and on the data tabs their sources. */}
      <header className="topbar">
        <div className="topbar-inner">
          <Brand className="brand">
            <a className="brand-link" href="/" onClick={goHome} title="Home">
              NOLA Atlas<span className="accent">.</span>
            </a>
          </Brand>
          <span className="brand-tag">Every address in New Orleans and Metairie, explained.</span>
          <div className="topbar-tools">
            {view !== "home" && <SourceChips meta={meta} />}
            {view !== "home" && IS_STATIC && meta?.generated && (
              <span className="snapshot-badge">Snapshot · {meta.generated.slice(0, 10)}</span>
            )}
            <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
          </div>
        </div>
      </header>
      <div className="container app-main">
        {view !== "home" && (
          <nav className="btn-row nav-tabs" aria-label="Main navigation">
            {VIEWS.map(([id, label]) => (
              <button
                key={id}
                className={`btn${view === id ? " is-active" : ""}`}
                onClick={() => navigate({ view: id, owner: null, ...(id === "property" ? {} : { q: null, street: null }) })}
                aria-current={view === id ? "page" : undefined}
              >
                {label}
              </button>
            ))}
            <a className="btn" href={SCHOOLS_URL} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openSchools)}>
              Schools ↗
            </a>
            <a className="btn" href={FLOODLENS_URL} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openFloodLens)}>
              Flood ↗
            </a>
          </nav>
        )}
        {!NO_STRIP.has(view) && <MacroStrip ctx={ctx} />}

        {error && <div className="error">Could not load market data: {error}</div>}
        <ErrorBoundary resetKey={`${view}|${url.q || ""}`}>
          {view === "home" && <Home ctx={ctx} />}
          {view === "overview" && <Overview ctx={ctx} />}
          {view === "scorecard" && <Scorecard ctx={ctx} />}
          {view === "compare" && <Compare ctx={ctx} />}
          {view === "macro" && <Macro ctx={ctx} />}
          {view === "property" && <Property ctx={ctx} />}
          {view === "ownership" && <Ownership ctx={ctx} />}
          {view === "power" && <Power theme={theme} />}
          {view === "about" && <About ctx={ctx} />}
        </ErrorBoundary>
      </div>
      <Footer generated={meta?.generated} sources={meta?.sources} />
    </div>
  );
}

function SourceChips({ meta }) {
  if (!meta) return null;
  const s = meta.sources || {};
  const chips = [
    ["Redfin", s.redfin?.rows > 0, s.redfin?.latest_period && `to ${s.redfin.latest_period.slice(0, 7)}`],
    ["Zillow", s.zillow?.rows > 0, s.zillow?.latest_month && `to ${s.zillow.latest_month.slice(0, 7)}`],
    ["FRED", s.fred?.rows > 0, s.fred?.latest_date ? `to ${s.fred.latest_date}` : "pending"],
    ["Assessors", s.assessor?.parcels > 0, s.assessor?.parcels ? `${s.assessor.parcels.toLocaleString()} parcels` : "pending"],
  ];
  return (
    <div className="source-chips" aria-label="Data source status">
      {chips.map(([name, ok, note]) => (
        <span key={name} className="chip" title={ok ? "Loaded" : "Not loaded yet"}>
          <span className={`chip-dot ${ok ? "ok" : "pending"}`} />
          {name}
          {note && <span style={{ color: "var(--text-dimmer)" }}>{note}</span>}
        </span>
      ))}
    </div>
  );
}

function ThemeToggle({ theme, onToggle }) {
  const dark = theme === "dark";
  return (
    <button className="theme-toggle" onClick={onToggle} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Switch to light mode" : "Switch to dark mode"}>
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  );
}
