import { useEffect, useMemo, useRef, useState } from "react";
import { getOwner, getOwnership, ownerKindLabel, recordQuery, suggestOwners } from "../api";
import GeoPicker from "../components/GeoPicker";
import OwnerMap from "../components/OwnerMap";
import WatchButton from "../components/WatchButton";
import { METRO, geoKey, geoLabel, parseGeo } from "../lib/geo";
import { EVENTS, trackEvent } from "../lib/metrics";
import { seriesColor } from "../lib/theme";

const SUGGEST_DEBOUNCE_MS = 150;

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

function highlightMatch(text, query) {
  const needle = query.trim();
  const i = needle ? text.toUpperCase().indexOf(needle.toUpperCase()) : -1;
  if (i === -1) return <span>{text}</span>;
  return (
    <>
      <span>{text.slice(0, i)}</span>
      <b>{text.slice(i, i + needle.length)}</b>
      <span>{text.slice(i + needle.length)}</span>
    </>
  );
}

// Search by owner name: the Assessors' public rolls, matched by suggestOwners (api.js). An owner
// with two or more records opens their owner page; one with a single record opens that property.
// Suggestions appear as you type (debounced, while a name bundle loads); Enter and the Search
// button don't wait for them — they look the name up straight away.
function OwnerSearch({ navigate }) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsFor, setSuggestionsFor] = useState(""); // the text the shown list was built for
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [noMatch, setNoMatch] = useState(false);
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  function pick(a) {
    setSuggestOpen(false);
    setQuery("");
    setNoMatch(false);
    trackEvent(EVENTS.searchOwner);
    if (a.kind === "owner") navigate({ owner: a.slug });
    else navigate({ view: "property", q: a.address, owner: null, street: null });
  }

  function onInput(v) {
    setQuery(v);
    setActiveIndex(-1);
    setNoMatch(false);
    clearTimeout(debounceRef.current);
    if (!v.trim()) {
      requestSeq.current++; // drop any lookup already in flight
      setSuggestions([]);
      setSuggestOpen(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const seq = ++requestSeq.current;
    debounceRef.current = setTimeout(async () => {
      const results = await suggestOwners(v, 8).catch(() => []);
      if (seq !== requestSeq.current) return;
      setSearching(false);
      setSuggestions(results);
      setSuggestionsFor(v);
      setSuggestOpen(results.length > 0);
    }, SUGGEST_DEBOUNCE_MS);
  }

  // Search now, without waiting for the debounced suggestions: take the best match straight
  // away, or say so when nothing matches.
  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    clearTimeout(debounceRef.current);
    const seq = ++requestSeq.current;
    setSearching(true);
    setNoMatch(false);
    const results = await suggestOwners(q, 8).catch(() => []);
    if (seq !== requestSeq.current) return;
    setSearching(false);
    if (results.length) {
      setSuggestions(results);
      pick(results[0]);
    } else {
      setSuggestions([]);
      setSuggestOpen(false);
      setNoMatch(true);
    }
  }

  function onKeyDown(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      // Enter used to do nothing until the suggestions had loaded; now it searches immediately.
      // A list still showing matches for earlier text (typed on before the debounce caught up) only
      // counts if the reader arrowed to an item in it; otherwise search what's in the box now.
      const listIsCurrent = suggestionsFor === query || activeIndex >= 0;
      if (suggestOpen && suggestions.length > 0 && listIsCurrent) pick(suggestions[activeIndex >= 0 ? activeIndex : 0]);
      else runSearch();
      return;
    }
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Search by owner name</h2>
          <div className="panel-subtitle">Find every property on the Assessors' rolls filed under a name.</div>
        </div>
      </div>
      <div className="search-row" ref={boxRef}>
        <div className="search-box">
          <input
            className="search-input"
            value={query}
            onChange={(e) => onInput(e.target.value)}
            onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Owner name, e.g. Housing Authority of New Orleans"
            aria-label="Owner name"
            role="combobox"
            aria-expanded={suggestOpen}
            aria-controls="owner-suggestions"
            aria-activedescendant={activeIndex >= 0 ? `owner-suggestion-${activeIndex}` : undefined}
            autoComplete="off"
          />
          {suggestOpen && (
            <div className="suggestions" id="owner-suggestions" role="listbox">
              {suggestions.map((a, i) => (
                <div
                  key={`${a.kind}-${a.address}`}
                  id={`owner-suggestion-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`suggestion${i === activeIndex ? " suggestion--active" : ""}`}
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseDown={(e) => { e.preventDefault(); pick(a); }}
                >
                  {highlightMatch(a.full, query)}
                  {a.sub && <span className="suggestion-sub">{a.sub}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="btn-primary" onClick={runSearch} disabled={!query.trim()}>
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      {noMatch && (
        <div className="stat-note" role="status" style={{ marginTop: -12 }}>
          {`No owner found for “${query}”. Try fewer words, or the name as written on the Assessor's roll.`}
        </div>
      )}
    </div>
  );
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
  const [ownerKind, setOwnerKind] = useState("all");
  const [ownersShown, setOwnersShown] = useState(10);
  useEffect(() => {
    getOwnership().then(setStats, (e) => setError(e.message));
  }, []);
  const geo = parseGeo(url.geo) || METRO;
  const area = stats?.[geoKey(geo)];
  const topOwners = !area ? [] : ownerKind === "all" ? area.top_owners : area.top_owners_by_kind?.[ownerKind] || [];
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
      <OwnerSearch navigate={navigate} />
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
              <h2 className="panel-title">{`Who owns ${geoLabel(geo, geos)}`}</h2>
              <div className="panel-subtitle">Every parcel and condo unit on the Assessors' rolls, by who it's written to.</div>
            </div>
          </div>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat">
              <div className="stat-label">Records</div>
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
              <div className="stat-sub">{area.homestead_share == null ? "Orleans doesn't publish homestead exemptions" : `of ${area.buildings.toLocaleString()} buildings are owned by a person and carry an exemption (homestead)`}</div>
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
              <div className="btn-row" role="tablist" aria-label="Owner type" style={{ marginBottom: 4 }}>
                {[["all", "All"], ...KINDS.map(([k, label]) => [k, label])].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={ownerKind === k} className={`btn btn-sm${ownerKind === k ? " is-active" : ""}`} onClick={() => { setOwnerKind(k); setOwnersShown(10); }}>
                    {label}
                  </button>
                ))}
              </div>
              {ownerKind !== "all" && !(area.top_owners_by_kind?.[ownerKind] || []).length && <div className="stat-note">No owner of this type holds more than one property here.</div>}
              <ul className="nearby-list" style={{ marginTop: 0 }}>
                {topOwners.slice(0, ownersShown).map(([slug, name, count, kind]) => (
                  <li key={slug || name}>
                    <button type="button" className="nearby-item" onClick={() => slug && navigate({ owner: slug })}>
                      <span className="nearby-street">{name}</span>
                      <span className="nearby-sub">{`${count.toLocaleString()} here · ${ownerKindLabel(kind)}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {topOwners.length > ownersShown && (
                <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => setOwnersShown(ownersShown + 20)}>
                  {`Show more (${topOwners.length - ownersShown} of the ${topOwners.length} largest)`}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {zipRows.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">ZIPs side by side</h2>
              <div className="panel-subtitle">Tap a column to sort, a row to open that ZIP.</div>
            </div>
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="ZIPs side by side">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ZIP · area</th>
                  {[
                    ["records", "Records"],
                    ["org", "Organizations + public"],
                    ["multi", "Owner holds 2+"],
                    ["big", "Owner holds 10+"],
                    ["home", "Lived in by owner *"],
                  ].map(([k, label]) => (
                    <th key={k} className={`num sortable${sort === k ? " is-sorted" : ""}`} aria-sort={sort === k ? "descending" : undefined}>
                      <button
                        type="button"
                        className="th-sort"
                        onClick={() => {
                          trackEvent(EVENTS.ownershipSort);
                          setSort(k);
                        }}
                      >
                        {label}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {zipRows.map((r) => (
                  <tr key={r.g.geo_id} className="clickable" onClick={() => navigate({ geo: geoKey(r.g) })}>
                    <td className="geo-cell">
                      <button
                        type="button"
                        className="row-link"
                        aria-label={`Who owns ${r.g.geo_id} ${r.g.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate({ geo: geoKey(r.g) });
                        }}
                      >
                        <span className="geo-id">{r.g.geo_id}</span> {r.g.name}
                      </button>
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
          {zipRows.some((r) => r.home == null) && (
            <div className="stat-note" style={{ marginTop: 10 }}>
              * Jefferson ZIPs only — Orleans doesn't publish homestead exemptions, so those rows show "—".
            </div>
          )}
        </div>
      )}

      <div className="method-note">
        <span>
          Counts are records on the Jefferson and Orleans Assessors' rolls; each condo unit is its own record. Owners are matched by name as written on the roll, so one owner spelled two ways counts twice, and two people with the same name count once. Organizations include companies, trusts, churches and nonprofits; public bodies include city, parish, state and federal agencies. "Lived in by the owner" is the share of Jefferson buildings that a person owns and that carry a property-tax exemption: in practice the homestead exemption, which only an owner's primary residence can claim. The roll gives every exemption combined, so a full exemption counts only when a person owns the building (a fully disabled veteran's home), not a church, school or public body.
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
            <WatchButton type="owner" id={slug} label={owner.name} record={owner} />
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
            <h2 className="panel-title">{`Every property (${owner.count.toLocaleString()})`}</h2>
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
        <span>Records are listed under this owner when the name on the roll matches once punctuation and word order are set aside, so different people or businesses with the same name can share this page, and a name written another way, or an affiliated company, isn't included. Names are shown as published on the Assessors' rolls, which lag sales and transfers and aren't verified here; this isn't a title search or proof of ownership. Corrections go to the Assessor's office.</span>
      </div>
    </div>
  );
}
