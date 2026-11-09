import { useState } from "react";
import power from "../data/power.json";
import { FLOODLENS_URL, SCHOOLS_URL } from "../lib/links";
import { EVENTS, trackEvent } from "../lib/metrics";
import { fmt, fmtCompactCurrency } from "../lib/theme";

// The hub: one address search, then a card per topic. Housing and Data center power are tabs of
// this app; Schools (School Finder) and Flood (FloodLens) are sister sites opened in a new tab.
export default function Home({ ctx }) {
  const { scorecard, meta, navigate } = ctx;
  const [q, setQ] = useState("");
  const metro = scorecard?.rows?.find((r) => r.geo_level === "metro");
  const plants = power.projects[0];

  function search(e) {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    trackEvent(EVENTS.hubSearch);
    navigate({ view: "property", q: text, street: null, owner: null });
  }

  return (
    <div>
      <form className="panel hub-search" onSubmit={search} role="search">
        <label className="hub-search-label" htmlFor="hub-q">
          Start with an address
        </label>
        <div className="search-row" style={{ marginBottom: 0 }}>
          <input
            id="hub-q"
            className="search-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Address or parcel number, e.g. 1617 Metairie Rd"
            autoComplete="off"
            maxLength={200}
          />
          <button className="btn-primary" type="submit">
            Look up
          </button>
        </div>
        <div className="stat-note" style={{ marginTop: 8 }}>
          {meta?.property_count ? `${meta.property_count.toLocaleString()} parcels and condo units` : "Every parcel"} in
          Jefferson and Orleans Parish: flood zone, monthly cost, assessment, owner and the market around it. To search
          by street or owner name, use{" "}
          <a
            href="/property/"
            onClick={(e) => {
              e.preventDefault();
              navigate({ view: "property" });
            }}
          >
            Property Lookup
          </a>
          .
        </div>
      </form>

      <div className="hub-grid">
        <HubCard
          kicker="Housing"
          title="Prices, rent and who owns what"
          stat={metro ? fmtCompactCurrency(metro.median_sale_price) : null}
          statNote={metro ? `metro median sale price · ${fmt.monthYear(metro.price_month)}` : null}
          text="Sale prices, home values, rent and inventory for every ZIP, plus property lookups and ownership."
          links={[
            { label: "Market overview", onClick: () => navigate({ view: "overview" }) },
            { label: "ZIP Scorecard", onClick: () => navigate({ view: "scorecard" }) },
            { label: "Ownership", onClick: () => navigate({ view: "ownership" }) },
          ]}
        />
        <HubCard
          kicker="Schools"
          title="Where can my child get in?"
          text="Every public and private school in Jefferson and Orleans: open seats, chances of getting in, tuition and key dates."
          links={[{ label: "Open School Finder ↗", href: SCHOOLS_URL, onClick: () => trackEvent(EVENTS.openSchools) }]}
        />
        <HubCard
          kicker="Flood"
          title="How exposed is this address?"
          text="FloodLens scores flood risk for any address and adds drainage, levee and storm-surge views, with past insurance claims nearby."
          links={[{ label: "Open FloodLens ↗", href: FLOODLENS_URL, onClick: () => trackEvent(EVENTS.openFloodLens) }]}
          note="May take a few seconds to wake up."
        />
        <HubCard
          kicker="Data center power"
          title="Who pays to power the data centers?"
          text={`New gas plants for Meta's Richland Parish data center: ${plants.power.split(";")[0]}, with more proposed. New Orleans has paused data centers while it writes rules.`}
          links={[{ label: "Follow the tracker", onClick: () => navigate({ view: "power" }) }]}
          note={`Checked ${fmt.monthYear(power.checked)}`}
        />
      </div>
    </div>
  );
}

function HubCard({ kicker, title, stat, statNote, text, links, note }) {
  return (
    <section className="panel hub-card">
      <div className="hub-kicker">{kicker}</div>
      <h2 className="hub-title">{title}</h2>
      {stat && (
        <div className="hub-stat">
          <span className="stat-value stat-value--accent">{stat}</span>
          <span className="stat-note">{statNote}</span>
        </div>
      )}
      <p className="hub-text">{text}</p>
      <div className="hub-links">
        {links.map((l) =>
          l.href ? (
            <a key={l.label} className="btn" href={l.href} target="_blank" rel="noreferrer" onClick={l.onClick}>
              {l.label}
            </a>
          ) : (
            <button key={l.label} className="btn" type="button" onClick={l.onClick}>
              {l.label}
            </button>
          )
        )}
      </div>
      {note && <div className="stat-note">{note}</div>}
    </section>
  );
}
