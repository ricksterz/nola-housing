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
  // A quiet, abstract skyline / riverbend — decoration only.
  return (
    <svg className="hero-skyline" viewBox="0 0 1200 120" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 120 L0 90 L40 90 L40 70 L70 70 L70 95 L110 95 L110 60 L130 60 L130 40 L150 40 L150 95 L200 95 L200 80 L240 80 L240 55 L260 55 L260 30 L280 30 L280 95 L330 95 L330 75 L360 75 L360 50 L380 50 L380 95 L430 95 L430 85 L470 85 L470 65 L500 65 L500 95 L560 95 L560 45 L580 45 L580 20 L600 20 L600 95 L650 95 L650 70 L690 70 L690 95 L740 95 L740 60 L770 60 L770 95 L820 95 L820 80 L860 80 L860 35 L880 35 L880 95 L930 95 L930 75 L970 75 L970 95 L1020 95 L1020 55 L1050 55 L1050 95 L1100 95 L1100 85 L1140 85 L1140 70 L1170 70 L1170 95 L1200 95 L1200 120 Z"
        fill="currentColor"
      />
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
