import power from "../data/power.json";
import { fmt } from "../lib/theme";

// Data center power: a hand-kept, sourced tracker (src/data/power.json, also read by
// etl/prerender.py). Facts and votes only, each with its source; where the two sides of the bill
// question disagree, both are given in their own words, attributed.

function day(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function Source({ href, children }) {
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function Power() {
  return (
    <div>
      <div className="panel panel--gold">
        <h2 className="hub-title" style={{ marginTop: 0 }}>Data center power in Louisiana</h2>
        <p className="hub-text">{power.intro}</p>
        <div className="stat-note">Last checked {day(power.checked)}.</div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Who sets your power rates</h3>
        <div className="panel-subtitle" style={{ marginBottom: 12 }}>
          New Orleans and Metairie are on different Entergy utilities with different regulators.
        </div>
        <div className="stat-grid">
          {power.utilities.map((u) => (
            <div className="stat" key={u.parish}>
              <div className="stat-label">{u.parish}</div>
              <div className="stat-value">{u.utility}</div>
              <div className="stat-sub">Regulated by the {u.regulator}</div>
              <p className="power-text">{u.note}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Projects</h3>
        <div className="power-list">
          {power.projects.map((p) => (
            <section key={p.name} className="power-item">
              <div className="power-item-head">
                <strong>{p.name}</strong>
                <span className="stat-note">{p.where}</span>
              </div>
              <div className="power-power">{p.power}</div>
              <p className="power-text">{p.status}</p>
              <div className="stat-note">
                Sources:{" "}
                {p.sources.map(([label, href], i) => (
                  <span key={href}>
                    {i > 0 && " · "}
                    <Source href={href}>{label}</Source>
                  </span>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3 className="panel-title">Decisions so far</h3>
        <ol className="power-timeline">
          {power.timeline.map((t) => (
            <li key={`${t.date}-${t.who}`}>
              <div className="power-date">{day(t.date)}</div>
              <div>
                <strong>{t.who}</strong>: {t.what} <Source href={t.source}>Source ↗</Source>
              </div>
            </li>
          ))}
        </ol>
        <p className="power-text">
          <strong>Next:</strong> {power.next}
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">What it could mean for your bill</h3>
        <div className="panel-subtitle" style={{ marginBottom: 12 }}>
          The two sides disagree; both are summarized here. NOLA Atlas takes no position.
        </div>
        <div className="stat-grid">
          {power.bills.map((b) => (
            <div className="stat" key={b.side}>
              <div className="stat-label">{b.side}</div>
              <p className="power-text">{b.text}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="method-note">
        Compiled by hand from news reports, company releases and public filings, last checked{" "}
        {fmt.monthYear(power.checked)}. Pending cases change; dates and figures can move, so check the linked sources
        and the LPSC's docket before relying on them. Not legal or financial advice.
      </p>
    </div>
  );
}
