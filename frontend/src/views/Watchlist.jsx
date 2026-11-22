import { useEffect, useRef, useState } from "react";
import { getOwner, getOwnershipCosts, getPropertyLookup, ownerKindLabel } from "../api";
import StatTile from "../components/StatTile";
import { assessorMarket, yearlyCost } from "../lib/costs";
import { floodInfo } from "../lib/flood";
import { pathFromParams } from "../lib/routes";
import { fmt, fmtCompactCurrency } from "../lib/theme";
import { copyText } from "../lib/clipboard";
import { EVENTS, trackEvent } from "../lib/metrics";
import { disableSync, enableSync, formatCode, joinSync, normalizeCode, syncAvailable, syncNow, useSync } from "../lib/sync";
import { changesSince, decodeList, encodeList, hasItem, itemKey, snapshotOf, useWatchlist } from "../lib/watchlist";
import { lastSale, ownerName } from "./Property";

// The reader's saved addresses, ZIP codes and owners, each with its latest numbers and what changed
// since it was saved. Everything shown is read from the site's own published files: the list never
// leaves this browser unless the reader copies its link, and the dashboard sends nothing to
// FloodLens (a report's flood details load when it's opened).

const SECTIONS = [
  ["property", "Saved addresses"],
  ["zip", "Saved ZIP codes"],
  ["owner", "Saved owners"],
];

// A list arriving in a link ("/watchlist/#list=..."): read once from the address bar.
function listFromHash() {
  const m = typeof window !== "undefined" && window.location.hash.match(/^#list=(.*)$/);
  if (!m) return null;
  return { items: decodeList(m[1]) };
}

// A sync code arriving in a link ("/watchlist/#sync=...").
function syncFromHash() {
  const m = typeof window !== "undefined" && window.location.hash.match(/^#sync=(.*)$/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1]; // a stray "%": the panel then says the link is damaged
  }
}

const clearHash = () => history.replaceState(null, "", window.location.pathname + window.location.search);

export default function Watchlist({ ctx }) {
  const { meta } = ctx;
  const watch = useWatchlist();
  const { list, remove } = watch;
  const [costs, setCosts] = useState(null);
  const [incoming, setIncoming] = useState(listFromHash);
  const [joinCode, setJoinCode] = useState(syncFromHash);
  const sync = useSync();
  const [changed, setChanged] = useState({}); // itemKey -> number of changes, once its card loads
  useEffect(() => {
    const onHash = () => {
      setIncoming(listFromHash());
      setJoinCode(syncFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const report = (key, n) => setChanged((c) => (c[key] === n ? c : { ...c, [key]: n }));
  const counted = list.filter((it) => changed[itemKey(it)] != null);
  const nChanged = counted.filter((it) => changed[itemKey(it)] > 0).length;
  useEffect(() => {
    if (!list.some((it) => it.type === "property")) return;
    let live = true;
    getOwnershipCosts().then((c) => live && setCosts(c));
    return () => {
      live = false;
    };
  }, [list]);

  return (
    <div>
      <div className="panel">
        <h2 className="panel-title">Your watchlist</h2>
        <p className="text-block" style={{ margin: "6px 0 0" }}>
          {list.length ? `${list.length} saved. ` : ""}
          {sync.on
            ? "Synced across your devices with your sync code, encrypted before it leaves this browser."
            : "Saved in this browser only: it isn't sent anywhere, and clearing this site's data (or Safari, after a week without a visit) removes it."}
          {meta?.generated ? ` Data as of ${fmt.date(meta.generated.slice(0, 10))}.` : ""}
        </p>
        {list.length > 0 && counted.length === list.length && (
          <p className="watch-summary" role="status">
            {nChanged ? `${nChanged} of ${list.length} changed since you saved them.` : "Nothing has changed since you saved these."}
          </p>
        )}
        {list.length > 0 && <BackupLink list={list} />}
      </div>

      {incoming && <IncomingList incoming={incoming} list={list} watch={watch} onDone={() => {
        clearHash();
        setIncoming(null);
      }} />}
      {joinCode && <SyncPanel sync={sync} joinCode={joinCode} onJoinDone={() => {
        clearHash();
        setJoinCode(null);
      }} />}

      {list.length === 0 && (
        <div className="panel">
          <div className="empty">
            <b>Nothing saved yet.</b> Press <b>Save</b> on a property report, a ZIP code&apos;s market page or an owner&apos;s page, and it appears here with its
            latest numbers: owner, value, last sale and flood zone for an address; home values and the pace of sales for a ZIP.
          </div>
        </div>
      )}

      {SECTIONS.map(([type, title]) => {
        const items = list.filter((it) => it.type === type);
        if (!items.length) return null;
        return (
          <section key={type} className="panel" aria-labelledby={`watch-${type}`}>
            <h2 className="panel-title" id={`watch-${type}`}>{`${title} (${items.length})`}</h2>
            <ul className="watch-grid">
              {items.map((it) => (
                <li key={it.id} className="watch-card">
                  {type === "property" && <PropertyCard item={it} costs={costs} ctx={ctx} onChanges={report} />}
                  {type === "zip" && <ZipCard item={it} ctx={ctx} onChanges={report} />}
                  {type === "owner" && <OwnerCard item={it} ctx={ctx} onChanges={report} />}
                  <button type="button" className="link-button watch-remove" onClick={() => remove(it.type, it.id)} aria-label={`Remove ${it.label} from your watchlist`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {!joinCode && <SyncPanel sync={sync} />}
    </div>
  );
}

/** A link that opens a page in the app (or a new tab with a modifier key). */
function OpenLink({ params, navigate, children }) {
  const href = pathFromParams(params) || "/";
  return (
    <a
      className="watch-title"
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate({ owner: null, q: null, street: null, geo: null, ...params });
        window.scrollTo({ top: 0 });
      }}
    >
      {children}
    </a>
  );
}

function Facts({ rows }) {
  const shown = rows.filter(([, v]) => v != null && v !== "");
  return (
    <dl className="watch-facts">
      {shown.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// Loads one record per card; a failed load says so on that card only.
function useRecord(load, id) {
  const [state, setState] = useState({ id: null, data: null, error: null });
  useEffect(() => {
    let live = true;
    load(id).then(
      (data) => live && setState({ id, data, error: null }),
      (e) => live && setState({ id, data: null, error: e.message || "Couldn't load it." }),
    );
    return () => {
      live = false;
    };
  }, [load, id]);
  return state.id === id ? state : { data: null, error: null };
}

function PropertyCard({ item, costs, ctx, onChanges }) {
  const { data, error } = useRecord(getPropertyLookup, item.id);
  const p = data?.parcel;
  const title = (
    <OpenLink params={{ view: "property", q: item.id }} navigate={ctx.navigate}>
      {p?.full_address || item.label}
    </OpenLink>
  );
  if (error) return (<>{title}<div className="stat-note">{`Couldn't load this address: ${error}`}</div></>);
  if (!p) return (<>{title}<div className="loading">Loading…</div></>);
  const market = p.tot_mkt_val || assessorMarket(p);
  const yearly = yearlyCost(p, costs);
  const sale = lastSale(p);
  const zone = floodInfo(p);
  return (
    <>
      {title}
      <div className="parcel-sub">{`${p.parish === "jefferson" ? "Jefferson" : "Orleans"} Parish${p.zip_code ? ` · ZIP ${p.zip_code}` : ""}`}</div>
      <Facts
        rows={[
          ["Owner", p.owner_name ? ownerName(p.owner_name) : null],
          ["Market value", market ? `${p.tot_mkt_val ? "" : "≈ "}${fmt.currency(market)}` : null],
          ["Assessed", p.assessed_val != null ? fmt.currency(p.assessed_val) : null],
          [sale.label, sale.value],
          ["Flood zone", zone ? `${(p.flood_zone || "").toUpperCase()} · ${zone.title}` : null],
          ["Tax + flood / yr", yearly ? `≈ ${fmt.currency(yearly.total)}` : null],
        ]}
      />
      {p.parish === "orleans" && p.assessed_val == null && <div className="stat-note">No assessed value or sale price on record yet for Orleans.</div>}
      <Changes item={item} record={p} onChanges={onChanges} />
    </>
  );
}

function ZipCard({ item, ctx, onChanges }) {
  const row = ctx.scorecard?.rows?.find((r) => r.geo_level === "zip" && r.geo_id === item.id);
  const title = (
    <OpenLink params={{ view: "overview", geo: `zip:${item.id}` }} navigate={ctx.navigate}>
      {item.label}
    </OpenLink>
  );
  if (!ctx.scorecard) return (<>{title}<div className="loading">Loading…</div></>);
  if (!row) return (<>{title}<div className="stat-note">No market data for this ZIP in the latest release.</div></>);
  return (
    <>
      {title}
      <div className="parcel-sub">{`Zillow ${fmt.monthYear(row.zhvi_month)} · Redfin ${fmt.monthYear(row.price_month)}`}</div>
      <div className="stat-grid watch-stats">
        <StatTile label="Typical home value" value={fmtCompactCurrency(row.zhvi)} delta={row.zhvi_yoy_pct} spark={row.spark_zhvi} />
        <StatTile label="Median sale price" value={fmtCompactCurrency(row.median_sale_price)} delta={row.price_yoy_pct} />
      </div>
      <Facts
        rows={[
          ["Median days on market", row.median_dom != null ? fmt.days(row.median_dom) : null],
          ["Months of supply", row.months_supply != null ? fmt.num(row.months_supply) : null],
          ["Typical rent", row.zori != null ? `${fmt.currency(row.zori)}/mo` : null],
        ]}
      />
      <Changes item={item} record={row} onChanges={onChanges} />
    </>
  );
}

function OwnerCard({ item, ctx, onChanges }) {
  const { data: o, error } = useRecord(getOwner, item.id);
  const title = (
    <OpenLink params={{ view: "ownership", owner: item.id }} navigate={ctx.navigate}>
      {o?.name || item.label}
    </OpenLink>
  );
  if (error) return (<>{title}<div className="stat-note">{error}</div></>);
  if (!o) return (<>{title}<div className="loading">Loading…</div></>);
  return (
    <>
      {title}
      <div className="parcel-sub">{ownerKindLabel(o.kind)}</div>
      <Facts
        rows={[
          ["Properties", o.count.toLocaleString()],
          ["In a high-risk flood zone", o.sfha_share == null ? null : `${Math.round(o.sfha_share * 1000) / 10}%`],
          ["Most in one ZIP", o.zips?.[0] ? `${o.zips[0][0]} · ${o.zips[0][1].toLocaleString()}` : null],
        ]}
      />
      <Changes item={item} record={o} onChanges={onChanges} />
    </>
  );
}

// ---- What changed since it was saved ---------------------------------------------------------

const money = (v) => (v == null ? "none" : fmt.currency(v));
const pctNote = (c) => (c.pct != null ? ` (${fmt.signedPct(c.pct)})` : "");

function saleText(v) {
  if (!v) return null;
  const [date, price] = v.split("|");
  return [date ? fmt.date(date) : null, price ? fmt.currency(Number(price)) : null].filter(Boolean).join(" · ");
}

/** One change in words. */
export function changeText(type, c) {
  switch (`${type}:${c.key}`) {
    case "property:owner":
      return c.to ? `New owner on the roll: ${ownerName(c.to)}${c.from ? ` (was ${ownerName(c.from)})` : ""}` : "No owner listed on the roll any more";
    case "property:sale":
      return c.to ? `New sale on record: ${saleText(c.to)}` : "The sale on record was removed";
    case "property:assessed":
      return `Assessed value ${money(c.from)} → ${money(c.to)}${pctNote(c)}`;
    case "property:market":
      return `Assessor market value ${money(c.from)} → ${money(c.to)}${pctNote(c)}`;
    case "property:exempt":
      return `Exemptions ${money(c.from ?? 0)} → ${money(c.to ?? 0)}`;
    case "property:zone":
      return `FEMA flood zone ${c.from || "none"} → ${c.to || "none"}`;
    case "zip:zhvi":
      return `Typical home value ${fmtCompactCurrency(c.from)} → ${fmtCompactCurrency(c.to)}${pctNote(c)}${c.month ? `, Zillow ${fmt.monthYear(c.month)}` : ""}`;
    case "zip:price":
      return `Median sale price ${fmtCompactCurrency(c.from)} → ${fmtCompactCurrency(c.to)}${pctNote(c)}${c.month ? `, Redfin ${fmt.monthYear(c.month)}` : ""}`;
    case "owner:count":
      return `Properties ${c.from ?? 0} → ${c.to ?? 0}`;
    default:
      return null;
  }
}

/** The card's "since you saved it" box. An item saved before snapshots existed gets today's
 *  numbers as its starting point. */
function Changes({ item, record, onChanges }) {
  const { setSnapshot } = useWatchlist();
  const missing = !item.snap && Boolean(record);
  const changes = item.snap ? changesSince(item.type, item.snap, record) : [];
  const key = itemKey(item);
  useEffect(() => {
    if (missing) setSnapshot(item.type, item.id, snapshotOf(item.type, record));
  }, [missing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (item.snap) onChanges(key, changes.length);
  }, [key, item.snap, changes.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!item.snap) return null;
  const since = fmt.date(item.snap.at.slice(0, 10));
  if (!changes.length) return <div className="watch-since">{`No changes since ${since}.`}</div>;
  return (
    <div className="watch-changes">
      <div className="watch-changes-head">{`Changed since ${since}`}</div>
      <ul>
        {changes.map((c) => (
          <li key={c.key}>{changeText(item.type, c)}</li>
        ))}
      </ul>
      <button type="button" className="link-button" aria-label={`Mark the changes to ${item.label} as seen`} onClick={() => setSnapshot(item.type, item.id, snapshotOf(item.type, record))}>
        Mark as seen
      </button>
    </div>
  );
}

// ---- Backup and share ------------------------------------------------------------------------

function BackupLink({ list }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    const ok = await copyText(`${window.location.origin}/watchlist/#list=${encodeList(list)}`);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 4000);
  }
  return (
    <div className="watch-backup">
      <button type="button" className="btn btn-sm" onClick={copy}>
        Copy link to this list
      </button>
      <span className="stat-note" role="status">
        {state === "copied"
          ? "Copied. Open it on another device, keep it as a backup, or send it to someone."
          : state === "failed"
            ? "Couldn't copy here; try another browser."
            : "A link that holds the list: to open it on another device, keep a backup, or share it."}
      </span>
    </div>
  );
}

function IncomingList({ incoming, list, watch, onDone }) {
  const items = incoming.items;
  if (!items || !items.length) {
    return (
      <div className="panel watch-incoming" role="region" aria-label="Shared watchlist">
        <p className="text-block">This watchlist link is incomplete or damaged, so there is nothing to add. Ask for it to be copied again.</p>
        <button type="button" className="btn btn-sm" onClick={onDone}>Dismiss</button>
      </div>
    );
  }
  const fresh = items.filter((it) => !hasItem(list, it.type, it.id)).length;
  const kinds = [
    ["property", "address", "addresses"],
    ["zip", "ZIP code", "ZIP codes"],
    ["owner", "owner", "owners"],
  ]
    .map(([t, one, many]) => [items.filter((it) => it.type === t).length, one, many])
    .filter(([n]) => n)
    .map(([n, one, many]) => `${n} ${n === 1 ? one : many}`);
  return (
    <div className="panel watch-incoming" role="region" aria-label="Shared watchlist">
      <h2 className="panel-title">A watchlist from a link</h2>
      <p className="text-block">
        {`This link holds ${kinds.join(", ")}. `}
        {list.length ? (fresh ? `${fresh} of them aren't on your list yet.` : "You have all of them already.") : "Your list is empty."}
      </p>
      <div className="parcel-actions">
        {fresh > 0 && (
          <button type="button" className="btn btn-sm btn-primary" onClick={() => { watch.importList(items); onDone(); }}>
            {list.length ? `Add ${fresh} to my list` : "Save them to my list"}
          </button>
        )}
        {list.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={() => {
              if (!window.confirm(`Replace your ${list.length} saved items with the ${items.length} in this link? Your current list will be gone.`)) return;
              watch.importList(items, { replace: true });
              onDone();
            }}>
            Replace my list with this one
          </button>
        )}
        <button type="button" className="btn btn-sm" onClick={onDone}>Not now</button>
      </div>
    </div>
  );
}

// ---- Sync across devices ---------------------------------------------------------------------

function ago(iso) {
  if (!iso) return null;
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return fmt.date(iso.slice(0, 10));
}

/** Turn sync on, join with a code or a link, or stop. Shown only where the sync Worker answers
 *  (or sync is already on), so the site works the same without it. */
function SyncPanel({ sync, joinCode, onJoinDone }) {
  const [available, setAvailable] = useState(null);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [error, setError] = useState(null);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let live = true;
    syncAvailable().then((ok) => live && setAvailable(ok));
    return () => {
      live = false;
    };
  }, []);
  if (!sync.on && !available && !joinCode) return null;

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(e.message || "Sync failed.");
      return false;
    }
  };
  const join = async (code) => {
    if (await act(() => joinSync(code))) {
      trackEvent(EVENTS.watchlistSyncJoin);
      setTyping(false);
      setInput("");
      onJoinDone?.();
    }
  };
  const copyLink = async () => {
    setCopied(await copyText(`${window.location.origin}/watchlist/#sync=${sync.code}`));
    setTimeout(() => setCopied(false), 4000);
  };

  if (joinCode && !sync.on) {
    const code = normalizeCode(joinCode);
    return (
      <div className="panel watch-incoming" role="region" aria-label="Join a synced watchlist">
        <h2 className="panel-title">Sync this watchlist here?</h2>
        <p className="text-block">
          {code
            ? "This link carries a sync code. Joining shows the same watchlist here and keeps it in step with the other devices; anything saved in this browser is added to it."
            : "This sync link is incomplete or damaged. Ask for it to be copied again, or choose Not now and enter the code under Sync across your devices."}
        </p>
        {error && <p className="stat-note watch-error" role="alert">{error}</p>}
        <div className="parcel-actions">
          {code && <button type="button" className="btn btn-sm btn-primary" disabled={sync.busy} onClick={() => join(code)}>{sync.busy ? "Joining…" : "Join"}</button>}
          <button type="button" className="btn btn-sm" onClick={onJoinDone}>Not now</button>
        </div>
      </div>
    );
  }

  return (
    <section className="panel" aria-labelledby="watch-sync">
      <h2 className="panel-title" id="watch-sync">Sync across your devices</h2>
      {!sync.on ? (
        <>
          <p className="text-block">
            Turn on sync to get a code. Enter it, or open its link, on your phone or another computer and the same list shows there, kept in step. The
            list is encrypted in this browser with the code before it&apos;s stored, so the site can&apos;t read it. No account or email.
          </p>
          {(error || sync.error) && <p className="stat-note watch-error" role="alert">{error || sync.error.message}</p>}
          <div className="parcel-actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={sync.busy} onClick={async () => {
              if (await act(enableSync)) {
                trackEvent(EVENTS.watchlistSyncOn);
                setShowCode(true);
              }
            }}>
              {sync.busy ? "Turning on…" : "Turn on sync"}
            </button>
            <button type="button" className="btn btn-sm" aria-expanded={typing} onClick={() => setTyping(!typing)}>I have a code</button>
          </div>
          {typing && (
            <form className="watch-code-form" onSubmit={(e) => { e.preventDefault(); join(input); }}>
              <label htmlFor="sync-code">Sync code</label>
              <input id="sync-code" className="search-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="XXXX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              <button type="submit" className="btn btn-sm btn-primary" disabled={sync.busy || !input.trim()}>{sync.busy ? "Joining…" : "Join"}</button>
            </form>
          )}
        </>
      ) : (
        <>
          <p className="text-block" role="status">
            {sync.busy ? "Syncing…" : sync.error ? sync.error.message : `Sync is on. Last synced ${ago(sync.lastSync) || "not yet"}.`}
          </p>
          <div className="watch-code">
            <span>Your sync code</span>
            <code>{showCode ? formatCode(sync.code) : "••••-••••-••••-••••-••••"}</code>
            <button type="button" className="link-button" onClick={() => setShowCode(!showCode)} aria-expanded={showCode}>{showCode ? "Hide" : "Show"}</button>
          </div>
          <p className="stat-note">Enter the code, or open the sync link, on your other devices. Anyone with either can see and change this list: share them only with people who should.</p>
          {error && <p className="stat-note watch-error" role="alert">{error}</p>}
          <div className="parcel-actions">
            <button type="button" className="btn btn-sm" onClick={copyLink}>{copied ? "Copied" : "Copy sync link"}</button>
            <button type="button" className="btn btn-sm" disabled={sync.busy} onClick={() => act(() => syncNow())}>Sync now</button>
            <button type="button" className="btn btn-sm" onClick={() => act(() => disableSync())}>Stop syncing here</button>
            <button type="button" className="btn btn-sm" onClick={() => {
              if (window.confirm("Delete the synced copy? Every device stops syncing; each keeps the list it has now.")) act(() => disableSync({ remove: true }));
            }}>
              Delete synced copy
            </button>
          </div>
        </>
      )}
    </section>
  );
}
