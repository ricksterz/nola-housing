import { useEffect, useState } from "react";
import { getOwner, getOwnershipCosts, getPropertyLookup, ownerKindLabel } from "../api";
import StatTile from "../components/StatTile";
import { assessorMarket, yearlyCost } from "../lib/costs";
import { floodInfo } from "../lib/flood";
import { pathFromParams } from "../lib/routes";
import { fmt, fmtCompactCurrency } from "../lib/theme";
import { useWatchlist } from "../lib/watchlist";
import { lastSale, ownerName } from "./Property";

// The reader's saved addresses, ZIP codes and owners, each with its latest numbers. Everything
// shown is read from the site's own published files: the list never leaves this browser, and the
// dashboard sends nothing to FloodLens (a report's flood details load when it's opened).

const SECTIONS = [
  ["property", "Saved addresses"],
  ["zip", "Saved ZIP codes"],
  ["owner", "Saved owners"],
];

export default function Watchlist({ ctx }) {
  const { meta } = ctx;
  const { list, remove } = useWatchlist();
  const [costs, setCosts] = useState(null);
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
          Saved in this browser only: it isn't sent anywhere, and clearing this site's data (or Safari, after a week without a visit) removes it.
          {meta?.generated ? ` Data as of ${fmt.date(meta.generated.slice(0, 10))}.` : ""}
        </p>
      </div>

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
                  {type === "property" && <PropertyCard item={it} costs={costs} ctx={ctx} />}
                  {type === "zip" && <ZipCard item={it} ctx={ctx} />}
                  {type === "owner" && <OwnerCard item={it} ctx={ctx} />}
                  <button type="button" className="link-button watch-remove" onClick={() => remove(it.type, it.id)} aria-label={`Remove ${it.label} from your watchlist`}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
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

function PropertyCard({ item, costs, ctx }) {
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
    </>
  );
}

function ZipCard({ item, ctx }) {
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
    </>
  );
}

function OwnerCard({ item, ctx }) {
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
    </>
  );
}
