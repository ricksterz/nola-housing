import { useEffect, useMemo, useState } from "react";
import { getOwner, getOwnership, ownerKindLabel, recordQuery } from "../api";
import GeoPicker from "../components/GeoPicker";
import OwnerMap from "../components/OwnerMap";
import { METRO, geoKey, geoLabel, parseGeo } from "../lib/geo";
import { EVENTS, trackEvent } from "../lib/metrics";
import { seriesColor } from "../lib/theme";

// Who owns what, from the Assessors' public rolls (etl/export_owners.py).
const KINDS = [
  ["individual", "Individuals", 0],
  ["organization", "Organizations", 1],
  ["government", "Public bodies", 2],
];
const HOLDERS = [
  ["1", "Own just this one", 0.35],
  ["2-9", "Own 2–9 on the rolls", 0.65],
  ["10+", "Own 10 or more", 1],
];
// Units at one unnumbered-unit address all read alike, so each record shows its own number.
const recordNumber = (r) => (r.slug.startsWith("parcel-") ? `${r.parish === "orleans" ? "Tax bill" : "Parcel"} ${r.slug.slice(7).toUpperCase()}` : null);
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "—");

export default function Ownership({ ctx }) {
  const { url } = ctx;
  return url.owner ? <OwnerPage key={url.owner} ctx={ctx} slug={url.owner} /> : <OwnershipStats ctx={ctx} />;
}

function StackedBar({ parts, total, label }) {
  return (
    <div className="own-bar-block">
      <div className="own-bar" role="img" aria-label={`${label}: ${parts.map((p) => `${p.label} ${pct(p.value, total)}`).join(", ")}`}>
        {parts.map((p) => (p.value ? <span key={p.label} style={{ width: `${(p.value / total) * 100}%`, background: p.color, opacity: p.opacity ?? 1 }} /> : null))}
      </div>
      <div className="own-legend">
        {parts.map((p) => (
          <span key={p.label} className="own-legend-item">
            <span className="swatch" style={{ background: p.color, opacity: p.opacity ?? 1 }} />
            <span>{p.label}</span>
            <b>{pct(p.value, total)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function OwnershipStats({ ctx }) {
  const { geos, navigate, url, theme } = ctx;
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState("org");
  useEffect(() => {
    getOwnership().then(setStats, (e) => setError(e.message));
  }, []);
  const geo = parseGeo(url.geo) || METRO;
  const area = stats?.[geoKey(geo)];
  const gold = typeof document !== "undefined" ? getComputedStyle(document.documentElement).getPropertyValue("--gold").trim() || "#d4953a" : "#d4953a";

  const zipRows = useMemo(() => {
    if (!stats || !geos) return [];
    const rows = geos
      .filter((g) => g.geo_level === "zip" && stats[geoKey(g)]?.with_owner)
      .map((g) => {
        const s = stats[geoKey(g)];
        const n = s.with_owner;
        return {
          g,
          s,
          org: (s.by_kind.organization + s.by_kind.government) / n,
          big: s.by_holder_size["10+"] / n,
          multi: (s.by_holder_size["2-9"] + s.by_holder_size["10+"]) / n,
          home: s.homestead_share,
        };
      });
    const key = { org: (r) => r.org, big: (r) => r.big, multi: (r) => r.multi, home: (r) => r.home ?? -1, records: (r) => r.s.records }[sort];
    return rows.sort((a, b) => key(b) - key(a));
  }, [stats, geos, sort]);

  if (error) return <div className="error">{error}</div>;
  return (
    <div>
      <GeoPicker
        geos={geos}
        selected={[geo]}
        onToggle={(g) => {
          trackEvent(EVENTS.ownershipArea);
          navigate({ geo: geoKey(g) });
        }}
      />
      {!area ? (
        <div className="panel">
          <div className="loading">{stats ? "No parcels on record for this area." : "Loading ownership…"}</div>
        </div>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">{`Who owns ${geoLabel(geo, geos)}`}</h3>
              <div className="panel-subtitle">Every parcel and condo unit on the Assessors' rolls, by who it's written to.</div>
            </div>
          </div>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat">
              <div className="stat-label">Properties</div>
              <div className="stat-value">{area.records.toLocaleString()}</div>
              <div className="stat-sub">{`${area.owners.toLocaleString()} owners`}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Owned by organizations or public bodies</div>
              <div className="stat-value">{pct(area.by_kind.organization + area.by_kind.government, area.with_owner)}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Owner holds 2 or more</div>
              <div className="stat-value">{pct(area.by_holder_size["2-9"] + area.by_holder_size["10+"], area.with_owner)}</div>
              <div className="stat-sub">anywhere in the two parishes</div>
            </div>
            <div className="stat">
              <div className="stat-label">Lived in by the owner</div>
              <div className="stat-value">{area.homestead_share == null ? "—" : pct(area.homestead_share, 1)}</div>
              <div className="stat-sub">{area.homestead_share == null ? "Orleans doesn't publish homestead exemptions" : `of ${area.buildings.toLocaleString()} buildings claim a homestead exemption`}</div>
            </div>
          </div>
          <div className="stat-section-title">Who owns them</div>
          <StackedBar label="Owners by kind" total={area.with_owner} parts={KINDS.map(([k, label, slot]) => ({ label, value: area.by_kind[k], color: seriesColor(slot, theme) }))} />
          <div className="stat-section-title" style={{ marginTop: 18 }}>How many the owner holds</div>
          <StackedBar label="Owners by holdings" total={area.with_owner} parts={HOLDERS.map(([k, label, opacity]) => ({ label, value: area.by_holder_size[k], color: gold, opacity }))} />
          <div className="stat-note" style={{ marginTop: 6 }}>{`The 10 largest owners here hold ${pct(area.top_owners_share, 1)} of it.`}</div>
          {area.top_owners.length > 0 && (
            <>
              <div className="stat-section-title" style={{ marginTop: 18 }}>Largest owners here</div>
              <ul className="nearby-list" style={{ marginTop: 0 }}>
                {area.top_owners.map(([slug, name, count, kind]) => (
                  <li key={slug || name}>
                    <button type="button" className="nearby-item" onClick={() => slug && navigate({ owner: slug })}>
                      <span className="nearby-street">{name}</span>
                      <span className="nearby-sub">{`${count.toLocaleString()} here · ${ownerKindLabel(kind)}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {zipRows.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h3 className="panel-title">ZIPs side by side</h3>
              <div className="panel-subtitle">Tap a column to sort, a row to open that ZIP.</div>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ZIP · area</th>
                  {[
                    ["records", "Properties"],
                    ["org", "Organizations + public"],
                    ["multi", "Owner holds 2+"],
                    ["big", "Owner holds 10+"],
                    ["home", "Lived in by owner"],
                  ].map(([k, label]) => (
                    <th key={k} className={`num sortable${sort === k ? " is-sorted" : ""}`} onClick={() => {
                      trackEvent(EVENTS.ownershipSort);
                      setSort(k);
                    }} aria-sort={sort === k ? "descending" : undefined}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zipRows.map((r) => (
                  <tr key={r.g.geo_id} className="clickable" onClick={() => navigate({ geo: geoKey(r.g) })}>
                    <td className="geo-cell">
                      <span className="geo-id">{r.g.geo_id}</span> {r.g.name}
                    </td>
                    <td className="num">{r.s.records.toLocaleString()}</td>
                    <td className="num">{pct(r.org, 1)}</td>
                    <td className="num">{pct(r.multi, 1)}</td>
                    <td className="num">{pct(r.big, 1)}</td>
                    <td className="num">{r.home == null ? "—" : pct(r.home, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="method-note">
        <span>
          Counts are records on the Jefferson and Orleans Assessors' rolls; each condo unit is its own record. Owners are matched by name as written on the roll, so one owner spelled two ways counts twice, and two people with the same name count once. Organizations include companies, trusts, churches and nonprofits; public bodies include city, parish, state and federal agencies. "Lived in by the owner" is the share of Jefferson buildings claiming a homestead exemption, which only an owner's primary residence can.
        </span>
      </div>
    </div>
  );
}

function OwnerPage({ ctx, slug }) {
  const { navigate, theme } = ctx;
  const [owner, setOwner] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(50);
  useEffect(() => {
    let alive = true;
    trackEvent(EVENTS.openOwnerPage);
    getOwner(slug).then(
      (o) => alive && setOwner(o),
      (e) => alive && setError(e.message),
    );
    return () => {
      alive = false;
    };
  }, [slug]);

  if (error) return <div className="error">{error}</div>;
  if (!owner) return <div className="panel"><div className="loading">Loading owner…</div></div>;
  const words = query.toUpperCase().split(/\s+/).filter(Boolean);
  const records = words.length ? owner.records.filter((r) => words.every((w) => (r.label || "").toUpperCase().includes(w) || (r.zip || "").includes(w))) : owner.records;
  const open = (r) => navigate({ view: "property", owner: null, q: recordQuery(r.slug, r.label) });
  const parishes = Object.entries(owner.parishes).map(([p, n]) => `${p === "jefferson" ? "Jefferson" : "Orleans"} ${n.toLocaleString()}`);

  return (
    <div>
      <div className="panel">
        <div className="parcel-header">
          <div>
            <div className="parcel-address">{owner.name}</div>
            <div className="parcel-sub">{`${ownerKindLabel(owner.kind)} · ${parishes.join(" · ")}`}</div>
            {owner.also_written.length > 0 && <div className="stat-note" style={{ marginTop: 4 }}>{`Also written ${owner.also_written.slice(0, 4).map((v) => `“${v}”`).join(", ")}`}</div>}
          </div>
          <div className="parcel-actions">
            <button type="button" className="btn" onClick={() => navigate({ owner: null })}>
              Ownership overview
            </button>
          </div>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="stat-label">Properties</div>
            <div className="stat-value">{owner.count.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Addresses</div>
            <div className="stat-value">{owner.addresses.toLocaleString()}</div>
          </div>
          <div className="stat">
            <div className="stat-label">In a high-risk flood zone</div>
            <div className="stat-value">{owner.sfha_share == null ? "—" : pct(owner.sfha_share, 1)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Most in one ZIP</div>
            <div className="stat-value">{owner.zips[0] ? `${owner.zips[0][0]} · ${owner.zips[0][1].toLocaleString()}` : "—"}</div>
            <div className="stat-sub">{`${owner.zips.length} tracked ZIPs`}</div>
          </div>
        </div>
      </div>

      <OwnerMap key={slug} records={owner.records} theme={theme} onPick={open} />

      <div className="panel">
        <div className="panel-head">
          <div>
            <h3 className="panel-title">{`Every property (${owner.count.toLocaleString()})`}</h3>
            <div className="panel-subtitle">Matched by the owner's name as written on the roll.</div>
          </div>
        </div>
        {owner.records.length > 12 && (
          <input className="search-input unit-filter" type="search" value={query} onChange={(e) => { setQuery(e.target.value); setShown(50); }} placeholder="Filter by address or ZIP" aria-label="Filter properties by address or ZIP" autoComplete="off" spellCheck={false} />
        )}
        {query && <div className="stat-note" style={{ margin: "6px 0 0" }}>{`${records.length} of ${owner.records.length} match`}</div>}
        <ul className="nearby-list">
          {records.slice(0, shown).map((r) => (
            <li key={r.slug}>
              <button type="button" className="nearby-item" onClick={() => open(r)}>
                <span className="nearby-street">{(r.label || "").split(",")[0]}</span>
                <span className="nearby-sub">{[(r.label || "").split(",").slice(1).join(",").trim(), recordNumber(r), r.zone ? `zone ${r.zone}` : null].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
        </ul>
        {records.length > shown && (
          <button type="button" className="btn" style={{ marginTop: 10 }} onClick={() => setShown(shown + 100)}>
            {`Show more (${(records.length - shown).toLocaleString()} left)`}
          </button>
        )}
      </div>
      <div className="method-note">
        <span>Records are listed under this owner when the name on the roll matches once punctuation and word order are set aside. A name written another way, or an affiliated company, isn't included.</span>
      </div>
    </div>
  );
}
