import { useEffect, useRef, useState } from "react";
import PowerMap from "../components/PowerMap";
import power from "../data/power.json";
import { daysUntil } from "../lib/power";

// AI data centers and the power behind them: a hand-kept, sourced tracker (src/data/power.json,
// also read by etl/prerender.py) laid out as a control room. Facts and votes only, each with its
// source; where the two sides of the bill question disagree, both are given, attributed. Every
// number on the page is read from power.json, never typed here.

const GROUPS = [
  ["all", "All"],
  ["lpsc", "State (LPSC)"],
  ["nola", "New Orleans"],
  ["parish", "Other parishes"],
  ["court", "Courts"],
];
const ROUTES = [
  { key: "orleans", label: "New Orleans", group: "nola" },
  { key: "jefferson", label: "Metairie / Jefferson", group: "lpsc" },
];

const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function parseDay(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
const day = (iso) => parseDay(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const mw = (n) => `${n.toLocaleString("en-US")} MW`;

/** Counts from 0 up to `target` once, on mount. Jumps straight there under reduced motion. */
function useCountUp(target, ms = 1100) {
  const [v, setV] = useState(() => (reduceMotion() ? target : 0));
  useEffect(() => {
    if (reduceMotion()) return;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min(1, (now - start) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Source({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Kpi({ value, unit, label }) {
  const n = useCountUp(value);
  return (
    <div className="ai-kpi">
      <div className="ai-kpi-value">
        {n.toLocaleString("en-US")}
        {unit && <span className="ai-kpi-unit">{unit}</span>}
      </div>
      <div className="ai-kpi-label">{label}</div>
    </div>
  );
}

// Decorative circuit traces behind the hero; packets run along them unless motion is reduced.
function Circuit() {
  const paths = [
    "M0 70 H180 L220 110 H420 L460 70 H760",
    "M0 190 H120 L160 150 H360 L400 190 H560 L600 230 H760",
    "M60 0 V40 L100 80 V260",
    "M640 0 V60 L600 100 V260",
    "M300 260 V220 L340 180 H520",
  ];
  return (
    <svg className="ai-circuit" viewBox="0 0 760 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {paths.map((d) => (
        <path key={d} d={d} className="ai-trace" />
      ))}
      {paths.map((d, i) => (
        <path key={`p${d}`} d={d} className="ai-packet" style={{ animationDelay: `${i * -1.3}s` }} />
      ))}
      {[
        [220, 110],
        [460, 70],
        [160, 150],
        [400, 190],
        [100, 80],
        [600, 100],
        [340, 180],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="3" className="ai-node" />
      ))}
    </svg>
  );
}

function Hero() {
  const meta = power.capacity[0];
  const hut8 = power.capacity[1];
  const metaMw = meta.rows.reduce((s, r) => s + r.mw, 0);
  const plants = meta.rows.reduce((s, r) => s + (r.plants || 0), 0);
  const [approved, proposed] = meta.rows;
  const [contracted, room] = hut8.rows;
  const vote = power.nextVote;
  const days = daysUntil(vote.date);
  return (
    <section className="ai-hero">
      <Circuit />
      <div className="ai-hero-body">
        <div className="ai-hero-top">
          <span className="ai-chip">
            <i className="ai-live" aria-hidden="true" /> Live tracker
          </span>
          <span className="ai-mono ai-dim">checked {power.checked}</span>
        </div>
        <h2 className="ai-title">
          AI data centers and <span className="ai-grad">Louisiana's power grid</span>
        </h2>
        <p className="ai-lede">{power.intro}</p>
        <div className="ai-kpis">
          <Kpi value={metaMw} unit="MW" label={`new gas generation for Meta's Hyperion AI data center: ${mw(approved.mw)} approved, ${mw(proposed.mw)} proposed`} />
          <Kpi value={plants} label={`gas plants: ${approved.plants} approved, ${proposed.plants} awaiting an LPSC vote`} />
          <Kpi value={contracted.mw} unit="MW" label={`contracted for Hut 8's River Bend AI campus, with room for ${mw(room.mw)} more`} />
          {days >= 0 ? (
            <Kpi value={days} unit={days === 1 ? "day" : "days"} label={`until the ${vote.what} (reports give ${vote.window})`} />
          ) : (
            <div className="ai-kpi">
              <div className="ai-kpi-value ai-kpi-value--sm">Vote due</div>
              <div className="ai-kpi-label">
                The {vote.what} was expected {vote.window}. This tracker hasn't been updated with the result yet.
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CapacityBars() {
  const [shown, setShown] = useState(reduceMotion());
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);
  const max = Math.max(...power.capacity.map((c) => c.rows.reduce((s, r) => s + r.mw, 0)));
  return (
    <div className="panel ai-panel">
      <div className="ai-panel-head">
        <span className="ai-index">01</span>
        <h3 className="panel-title">Megawatts on the table</h3>
      </div>
      <div className="ai-bars">
        {power.capacity.map((c) => {
          const total = c.rows.reduce((s, r) => s + r.mw, 0);
          return (
            <div className="ai-bar-block" key={c.project}>
              <div className="ai-bar-head">
                <strong>{c.project}</strong>
                <span className="ai-mono ai-dim">{c.measure}</span>
                <span className="ai-mono ai-bar-total">{mw(total)}</span>
              </div>
              <div className="ai-bar" role="img" aria-label={`${c.project}: ${c.rows.map((r) => `${r.label} ${mw(r.mw)}`).join(", ")}`}>
                {c.rows.map((r) => (
                  <span
                    key={r.label}
                    className={`ai-seg ai-seg--${r.stage}`}
                    style={{ width: shown ? `${(r.mw / max) * 100}%` : 0 }}
                  />
                ))}
              </div>
              <div className="ai-bar-legend">
                {c.rows.map((r) => (
                  <span key={r.label} className="ai-legend-item">
                    <i className={`ai-swatch ai-seg--${r.stage}`} />
                    {r.label} <b className="ai-mono">{mw(r.mw)}</b> <span className="ai-dim">{r.detail}</span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="power-text ai-footnote">
        Both bars use the same scale. Meta's is power-plant capacity being built for its data center; Hut 8's is
        electricity contracted from the grid. Solid is approved or signed; striped is proposed or optional.
      </p>
    </div>
  );
}

function MapPanel({ theme }) {
  return (
    <div className="panel ai-panel">
      <div className="ai-panel-head">
        <span className="ai-index">02</span>
        <h3 className="panel-title">Where the power goes</h3>
      </div>
      <PowerMap sites={power.sites} theme={theme} />
      <div className="ai-bar-legend" style={{ marginTop: 10 }}>
        <span className="ai-legend-item"><span className="pm-dot pm-dot--datacenter pm-dot--building pm-dot--static" /> AI data center</span>
        <span className="ai-legend-item"><span className="pm-dot pm-dot--plant pm-dot--approved" /> Gas plant, approved</span>
        <span className="ai-legend-item"><span className="pm-dot pm-dot--plant pm-dot--proposed" /> Gas plant, proposed</span>
        <span className="ai-legend-item"><span className="pm-dot pm-dot--datacenter pm-dot--withdrawn" /> Withdrawn</span>
      </div>
      <div className="stat-note" style={{ marginTop: 6 }}>
        Locations are approximate; Pointe Coupee's plants are shown at the parish because the site isn't mapped here.
      </div>
    </div>
  );
}

function RateRoute({ route, setRoute, onShowDecisions }) {
  const r = ROUTES.find((x) => x.key === route);
  const u = power.utilities[ROUTES.indexOf(r)];
  return (
    <div className="panel ai-panel">
      <div className="ai-panel-head">
        <span className="ai-index">03</span>
        <h3 className="panel-title">Who sets your power rates</h3>
      </div>
      <div className="ai-toggle" role="radiogroup" aria-label="Where you live">
        {ROUTES.map((x) => (
          <button
            key={x.key}
            type="button"
            role="radio"
            aria-checked={route === x.key}
            className={`ai-toggle-btn${route === x.key ? " is-on" : ""}`}
            onClick={() => setRoute(x.key)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <ol className="ai-route" key={route}>
        <li className="ai-route-node">
          <span className="ai-route-k">Your address</span>
          <span className="ai-route-v">{u.parish}</span>
        </li>
        <li className="ai-route-node">
          <span className="ai-route-k">Utility</span>
          <span className="ai-route-v">{u.utility}</span>
        </li>
        <li className="ai-route-node ai-route-node--end">
          <span className="ai-route-k">Sets rates and approves plants</span>
          <span className="ai-route-v">{u.regulator}</span>
        </li>
      </ol>
      <p className="power-text">{u.note}</p>
      <button type="button" className="btn ai-btn" onClick={() => onShowDecisions(r.group)}>
        Show this regulator's decisions ↓
      </button>
    </div>
  );
}

function Projects() {
  return (
    <div className="panel ai-panel">
      <div className="ai-panel-head">
        <span className="ai-index">04</span>
        <h3 className="panel-title">Projects</h3>
      </div>
      <div className="ai-cards">
        {power.projects.map((p) => (
          <section key={p.name} className={`ai-card ai-card--${p.tone}`}>
            <div className="ai-card-top">
              <span className={`ai-status ai-status--${p.tone}`}>{p.stage}</span>
            </div>
            <h4 className="ai-card-title">{p.name}</h4>
            <div className="ai-mono ai-dim ai-card-where">{p.where}</div>
            <div className="ai-card-power">{p.power}</div>
            <p className="power-text">{p.status}</p>
            <div className="ai-sources">
              {p.sources.map(([label, href]) => (
                <Source key={href} href={href}>
                  {label} ↗
                </Source>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function DecisionLog({ group, setGroup, logRef }) {
  const counts = Object.fromEntries(GROUPS.map(([k]) => [k, k === "all" ? power.timeline.length : power.timeline.filter((t) => t.group === k).length]));
  const items = power.timeline.filter((t) => group === "all" || t.group === group);
  const vote = power.nextVote;
  const days = daysUntil(vote.date);
  return (
    <div className="panel ai-panel" ref={logRef}>
      <div className="ai-panel-head">
        <span className="ai-index">05</span>
        <h3 className="panel-title">Decision log</h3>
      </div>
      <div className="ai-filters" role="group" aria-label="Filter decisions">
        {GROUPS.map(([k, label]) => (
          <button key={k} type="button" aria-pressed={group === k} className={`ai-filter${group === k ? " is-on" : ""}`} onClick={() => setGroup(k)}>
            {label} <span className="ai-mono">{counts[k]}</span>
          </button>
        ))}
      </div>
      <ol className="ai-log">
        {items.map((t) => (
          <li key={`${t.date}-${t.who}`} className={`ai-log-item ai-log--${t.group}`}>
            <div className="ai-log-date ai-mono">{t.date}</div>
            <div>
              <span className={`ai-actor ai-log--${t.group}`}>{t.who}</span>
              <p className="ai-log-what">
                {t.what} <Source href={t.source}>Source ↗</Source>
              </p>
            </div>
          </li>
        ))}
        {(group === "all" || group === "lpsc") && (
          <li className="ai-log-item ai-log-item--next">
            <div className="ai-log-date ai-mono">{days >= 0 ? `T-${days}d` : "due"}</div>
            <div>
              <span className="ai-actor ai-actor--next">Next</span>
              <p className="ai-log-what">{power.next}</p>
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

function Bills() {
  return (
    <div className="panel ai-panel">
      <div className="ai-panel-head">
        <span className="ai-index">06</span>
        <h3 className="panel-title">What it could mean for your bill</h3>
      </div>
      <div className="panel-subtitle" style={{ marginBottom: 12 }}>
        The two sides disagree; both are summarized here. NOLA Atlas takes no position.
      </div>
      <div className="ai-versus">
        {power.bills.map((b, i) => (
          <div className="ai-side" key={b.side}>
            <div className="ai-side-k ai-mono">{i === 0 ? "A" : "B"}</div>
            <div>
              <div className="ai-side-title">{b.side}</div>
              <p className="power-text">{b.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Power({ theme }) {
  const [route, setRoute] = useState("orleans");
  const [group, setGroup] = useState("all");
  const logRef = useRef(null);

  function showDecisions(g) {
    setGroup(g);
    logRef.current?.scrollIntoView({ behavior: reduceMotion() ? "auto" : "smooth", block: "start" });
  }

  return (
    <div className="ai-page">
      <Hero />
      <CapacityBars />
      <MapPanel theme={theme} />
      <RateRoute route={route} setRoute={setRoute} onShowDecisions={showDecisions} />
      <Projects />
      <DecisionLog group={group} setGroup={setGroup} logRef={logRef} />
      <Bills />
      <p className="method-note">
        Compiled by hand from news reports, company releases and public filings, last checked {day(power.checked)}. Pending cases change; dates and figures can move, so check the linked sources
        and the LPSC's docket before relying on them. Not legal or financial advice.
      </p>
    </div>
  );
}
