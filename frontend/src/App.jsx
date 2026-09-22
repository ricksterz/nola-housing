import { useEffect, useMemo, useState } from "react";
import { getMacroSnapshot, getMeta, getScorecard, IS_STATIC } from "./api";
import Footer from "./components/Footer";
import MacroStrip from "./components/MacroStrip";
import About from "./views/About";
import Compare from "./views/Compare";
import Macro from "./views/Macro";
import Overview from "./views/Overview";
import Property from "./views/Property";
import Scorecard from "./views/Scorecard";

const VIEWS = [
  ["overview", "Market Overview"],
  ["scorecard", "ZIP Scorecard"],
  ["compare", "Compare"],
  ["macro", "Macro"],
  ["property", "Property Lookup"],
  ["about", "About"],
];

function readUrl() {
  const p = new URLSearchParams(window.location.search);
  return Object.fromEntries(p.entries());
}

export default function App() {
  const [url, setUrl] = useState(readUrl);
  const view = VIEWS.some(([v]) => v === url.view) ? url.view : "overview";
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
    const href = qs ? `?${qs}` : window.location.pathname;
    if (replace) history.replaceState(null, "", href);
    else history.pushState(null, "", href);
    setUrl(next);
  }

  const geos = meta?.geos || null;
  const ctx = useMemo(
    () => ({ theme, meta, geos, macro, scorecard, navigate, url }),
    [theme, meta, geos, macro, scorecard, url]
  );

  return (
    <div className="app-shell">
      <div className="container app-main">
        <header className="hero">
          <Skyline />
          <div className="hero-content">
            <div className="header-tools">
              <SourceChips meta={meta} />
              {IS_STATIC && meta?.generated && (
                <span className="snapshot-badge">Snapshot · {meta.generated.slice(0, 10)}</span>
              )}
              <ThemeToggle theme={theme} onToggle={() => setTheme(theme === "dark" ? "light" : "dark")} />
            </div>
            <h1 className="app-title">
              NOLA Housing Pulse<span className="accent">.</span>
            </h1>
            <p className="app-subtitle">
              Home values, rents, market velocity and parcel records for <b>Metairie</b>, <b>Old Metairie</b> and{" "}
              <b>New Orleans</b> — every ZIP across Jefferson and Orleans Parish, from the parish assessors,
              Redfin, Zillow and FRED.
            </p>
          </div>
        </header>

        <MacroStrip ctx={ctx} />

        <nav className="btn-row" aria-label="Main navigation">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              className={`btn${view === id ? " is-active" : ""}`}
              onClick={() => navigate({ view: id })}
              aria-current={view === id ? "page" : undefined}
            >
              {label}
            </button>
          ))}
        </nav>

        {error && <div className="error">Could not load market data: {error}</div>}
        {view === "overview" && <Overview ctx={ctx} />}
        {view === "scorecard" && <Scorecard ctx={ctx} />}
        {view === "compare" && <Compare ctx={ctx} />}
        {view === "macro" && <Macro ctx={ctx} />}
        {view === "property" && <Property ctx={ctx} />}
        {view === "about" && <About ctx={ctx} />}
      </div>
      <Footer generated={meta?.generated} />
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

function Skyline() {
  // A quiet, abstract Jackson Square — St. Louis Cathedral's triple spires
  // flanked by the Cabildo and Presbytère, garden trees, a carriage and a
  // flag — decoration only, so it stays a pure silhouette (no people, no
  // traffic to draw).
  return (
    <svg className="hero-skyline" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 120
           L0 108 L15 108 L15 96 L30 96 L30 110 L48 110 L48 98 L66 98 L66 112 L84 112 L84 100 L102 100 L102 114 L120 114 L120 104 L140 104 L140 116 L160 116 L160 106 L190 106
           L190 96 L200 96
           L200 65 L280 65 L280 42 L310 42 L310 65 L380 65
           L380 100 L540 100
           L550 80 L570 80 L590 32 L610 80 L650 80 L670 8 L690 80 L730 80 L750 32 L770 80 L790 80
           L800 100 L815 100
           L815 65 L895 65 L895 42 L925 42 L925 65 L995 65
           L995 96 L1005 96
           L1015 96 L1015 15 L1035 22 L1015 29 L1015 106
           L1030 106 L1030 116 L1050 116 L1050 104 L1068 104 L1068 114 L1086 114 L1086 100 L1104 100 L1104 112 L1122 112 L1122 98 L1140 98 L1140 110 L1160 110 L1160 108 L1200 108
           L1200 120 Z"
        fill="currentColor"
      />
      {/* Carriage sits in the open gap left of the cathedral, clear of the building silhouettes. */}
      <g fill="currentColor">
        <circle cx="410" cy="108" r="9" />
        <circle cx="457" cy="108" r="9" />
        <rect x="400" y="88" width="68" height="14" rx="2" />
        <path d="M400 88 L406 74 L462 74 L468 88 Z" opacity="0.7" />
        <rect x="474" y="96" width="4" height="12" />
        <path d="M478 100 L498 100 L498 108 L504 108 L504 92 L508 92 L508 108 L514 108 L514 82 L496 82 L496 92 L478 92 Z" />
        <circle cx="512" cy="76" r="6" />
      </g>
    </svg>
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
