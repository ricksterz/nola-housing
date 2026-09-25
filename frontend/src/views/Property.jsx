import { useEffect, useRef, useState } from "react";
import { Line, LineChart } from "recharts";
import { getOwnershipCosts, getPropertyLookup, getTrend, suggestAddresses } from "../api";
import ChartPanel from "../components/ChartPanel";
import { CostInputs } from "../components/MonthlyCost";
import NearbyMap from "../components/NearbyMap";
import Table from "../components/Table";
import { Frame, currencyAxis, lineProps } from "../components/charts";
import { COST_PARTS, HOMEOWNERS_RANGE, HOMESTEAD_EXEMPT_DEFAULT, annualTax, floodGroup, monthlyCost, useCostAssumptions } from "../lib/costs";
import { monthLabel } from "../lib/rangeUtils";
import { fmt, fmtCompactCurrency, seriesColor } from "../lib/theme";

const SUGGEST_DEBOUNCE_MS = 150;

export default function Property({ ctx }) {
  const { meta, theme, navigate, url, macro, scorecard } = ctx;
  const [address, setAddress] = useState(url.q || "");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [trend, setTrend] = useState(null);
  const count = meta?.property_count ?? null;
  const boxRef = useRef(null);
  const debounceRef = useRef(null);
  const requestSeq = useRef(0);

  // Load the address in the URL: on arrival, and again when Back/Forward changes it. A search
  // rewrites q to the full address it found, which then matches and doesn't search twice.
  useEffect(() => {
    if (url.q && url.q !== data?.parcel?.full_address) search(url.q);
  }, [url.q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const zip = data?.parcel?.zip_code;
    if (!zip) return;
    getTrend("zip", zip).then((t) => setTrend(t.series)).catch(() => setTrend(null));
  }, [data]);

  useEffect(() => {
    function onClickOutside(e) {
      if (boxRef.current && !boxRef.current.contains(e.target)) setSuggestOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // A nearby home picked from the map or list: open it and bring the search box back into view,
  // keeping the previous home in history so Back returns to it.
  function pickNearby(street) {
    setAddress(street);
    search(street, { push: true });
    boxRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function search(addr = address, { push = false } = {}) {
    if (!addr.trim()) return;
    setSuggestOpen(false);
    setLoading(true);
    setError(null);
    setData(null);
    setTrend(null);
    getPropertyLookup(addr)
      .then((d) => {
        setData(d);
        // Show the full "street, city, LA zip" once we know it — the search key stays the
        // plain street address (getPropertyLookup strips anything after the first comma).
        const full = d.parcel.full_address || addr;
        setAddress(full);
        navigate({ q: full }, { replace: !push });
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  function onInput(v) {
    setAddress(v);
    setActiveIndex(-1);
    clearTimeout(debounceRef.current);
    if (!v.trim()) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }
    const seq = ++requestSeq.current;
    debounceRef.current = setTimeout(async () => {
      const results = await suggestAddresses(v).catch(() => []);
      if (seq !== requestSeq.current) return; // a newer keystroke superseded this request
      setSuggestions(results);
      setSuggestOpen(results.length > 0);
    }, SUGGEST_DEBOUNCE_MS);
  }

  function pick(a) {
    setAddress(a.full);
    setSuggestOpen(false);
    search(a.address);
  }

  function onKeyDown(e) {
    if (suggestOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        return;
      }
      if (e.key === "Escape") {
        setSuggestOpen(false);
        return;
      }
      if (e.key === "Enter" && activeIndex >= 0) {
        e.preventDefault();
        pick(suggestions[activeIndex]);
        return;
      }
    }
    if (e.key === "Enter") search();
  }

  return (
    <div>
      {count === 0 && (
        <div className="empty" style={{ marginBottom: 16 }}>
          <b>Parcel records are not loaded yet.</b> The assessor leg pulls Jefferson Parish and Orleans Parish
          records on the parishes' own calendars — Orleans during its Jul 15 – Aug 15 open-rolls window and
          Jefferson after the Aug 15 – Sep 15 inspection period — probing each parish's official bulk data first
          and only then batch-pulling the public search sites under a strict rate limit. Once a pull has run,
          search any street address here for owner, assessed and market value, value history and the ZIP's
          market context.
        </div>
      )}
      {count > 0 && (
        <div className="num" style={{ fontSize: 12, color: "var(--text-dimmer)", marginBottom: 10 }}>
          {count.toLocaleString()} parcels available
        </div>
      )}

      <div className="search-row" ref={boxRef}>
        <input
          className="search-input"
          value={address}
          onChange={(e) => onInput(e.target.value)}
          onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Street address, e.g. 123 METAIRIE RD"
          aria-label="Street address"
          role="combobox"
          aria-expanded={suggestOpen}
          aria-controls="address-suggestions"
          aria-activedescendant={activeIndex >= 0 ? `address-suggestion-${activeIndex}` : undefined}
          autoComplete="off"
        />
        {suggestOpen && (
          <div className="suggestions" id="address-suggestions" role="listbox">
            {suggestions.map((a, i) => (
              <div
                key={a.address}
                id={`address-suggestion-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                className={`suggestion${i === activeIndex ? " suggestion--active" : ""}`}
                onMouseEnter={() => setActiveIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); pick(a); }}
              >
                {highlightMatch(a.full, address)}
              </div>
            ))}
          </div>
        )}
        <button className="btn-primary" onClick={() => search()} disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {data && <ParcelCard data={data} trend={trend} theme={theme} navigate={navigate} macro={macro} scorecard={scorecard} onPick={pickNearby} />}
    </div>
  );
}

function highlightMatch(text, query) {
  const needle = query.trim();
  if (!needle) return text;
  const i = text.toUpperCase().indexOf(needle.toUpperCase());
  if (i === -1) return text;
  return (
    <>
      {text.slice(0, i)}
      <b>{text.slice(i, i + needle.length)}</b>
      {text.slice(i + needle.length)}
    </>
  );
}

// Assessor style is "LAST,FIRST M & CO OWNER" with no space after the comma. A trailing "&" means
// the record names a co-owner the Assessor didn't publish in the name field.
function ownerName(raw) {
  const s = String(raw).replace(/\s*,\s*/g, ", ").replace(/\s*&\s*/g, " & ").trim();
  return s.endsWith("&") ? `${s.slice(0, -1).trim()} & co-owner` : s;
}

// A clean link to this property (view + address only), copied for sharing. Falls back to a
// hidden textarea where the async Clipboard API isn't available (older iOS, non-secure hosts).
function CopyLinkButton({ address }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("copy failed");
  }

  async function copy() {
    const url = `${window.location.origin}${window.location.pathname}?view=property&q=${encodeURIComponent(address)}`;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else legacyCopy(url);
      setState("copied");
    } catch {
      try {
        legacyCopy(url);
        setState("copied");
      } catch {
        setState("failed");
      }
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button type="button" className="btn" onClick={copy} aria-live="polite">
      {state === "copied" ? "Link copied ✓" : state === "failed" ? "Couldn't copy" : "Copy link"}
    </button>
  );
}

// The Jefferson Assessor publishes a sale price and whether it was a qualified (arm's-length)
// sale, but not the sale date. $0 means none recorded; family transfers and successions carry
// nominal prices, which is exactly why the qualified flag has to travel with the number.
function lastSale(p) {
  if (p.last_sale_date) {
    return { label: "Last sale", value: `${fmt.date(p.last_sale_date)} · ${fmt.currency(p.last_sale_price)}` };
  }
  if (!(p.last_sale_price > 0)) return { label: "Last sale", value: null };
  const note =
    p.last_sale_qualified === true
      ? "Qualified sale · date not published"
      : p.last_sale_qualified === false
        ? "Not a qualified (arm's-length) sale · date not published"
        : "Date not published";
  return { label: "Last sale price", value: fmt.currency(p.last_sale_price), note };
}

// FEMA zone → plain language. SFHA ("special flood hazard area") zones are A* and V*; lenders
// must require flood insurance there on federally backed mortgages.
function floodInfo(p) {
  const zone = (p.flood_zone || "").toUpperCase();
  if (!zone) return null;
  const sub = (p.flood_zone_subtype || "").toUpperCase();
  const required = "Lenders require flood insurance here on federally backed mortgages.";
  if (zone.startsWith("V")) {
    return { tone: "high", title: "High-risk coastal flood area", detail: `1% or greater chance of flooding each year, with storm-wave hazard. ${required}` };
  }
  if (zone.startsWith("A")) {
    return { tone: "high", title: "High-risk flood area", detail: `1% or greater chance of flooding each year (the "100-year" floodplain). ${required}` };
  }
  const outside = "Flood insurance isn't federally required here, but FEMA reports more than 20% of flood insurance claims come from outside high-risk areas.";
  if (zone === "X" && sub.includes("LEVEE")) {
    return { tone: "moderate", title: "Reduced risk because of levees", detail: `FEMA credits a levee system with lowering the risk here. Levees can be overtopped or fail. ${outside}` };
  }
  if (zone === "X" && sub.includes("0.2")) {
    return { tone: "moderate", title: "Moderate flood risk", detail: `Between a 1% and 0.2% chance of flooding each year. ${outside}` };
  }
  if (zone === "X") {
    return { tone: "low", title: "Minimal flood hazard on FEMA's map", detail: outside };
  }
  if (zone === "D") {
    return { tone: "low", title: "Flood risk undetermined", detail: "FEMA hasn't analyzed flood hazards for this area." };
  }
  return { tone: "low", title: `FEMA zone ${zone}`, detail: "" };
}

function FloodZone({ p }) {
  const f = floodInfo(p);
  if (!f) return null;
  return (
    <div className={`flood-card flood-card--${f.tone}`}>
      <div className="flood-zone">
        Flood zone {p.flood_zone}
        {p.flood_sfha ? " · special flood hazard area" : ""}
      </div>
      <div className="flood-title">{f.title}</div>
      {f.detail && <div className="flood-detail">{f.detail}</div>}
      <div className="method-note" style={{ marginTop: 6 }}>
        FEMA National Flood Hazard Layer, effective maps{p.nfhl_pulled_at ? ` · pulled ${p.nfhl_pulled_at.slice(0, 10)}` : ""}.
        Placed by the lot's center point. A map zone, not an elevation certificate or an insurance quote.
      </div>
    </div>
  );
}

const FLOOD_GROUP_LABEL = {
  sfha: "high-risk (A/V) zone policies",
  other: "policies outside high-risk zones",
  all: "all single-family policies",
};

// Tax rate and flood cost are published by ZIP, so this only appears for parcels placed in one
// of the covered ZIPs. The price starts at the ZIP's latest median sale (the same figure the
// Scorecard uses), else Zillow's typical value — the Assessor publishes no market value to
// start from — and is the reader's to change.
function startingPrice(p, scorecard) {
  const row = scorecard?.rows?.find((r) => r.geo_level === "zip" && r.geo_id === p.zip_code);
  if (row?.median_sale_price) return { price: row.median_sale_price, basis: "median sale price" };
  if (p.zhvi) return { price: p.zhvi, basis: "typical home value (Zillow)" };
  return { price: null, basis: null };
}

function taxNote(tax, zip, homestead, exempt) {
  if (!tax) return `No published rate for ${zip}.`;
  const years = `Census ACS ${tax.acs_year - 4}–${tax.acs_year}`;
  if (tax.full_rate == null)
    return `${(tax.effective_rate * 100).toFixed(2)}% of price a year: what owner-occupants in ${zip} actually pay (${years}). Reflects the homestead exemption; an owner who doesn't live here pays more.`;
  const rate = `${(tax.full_rate * 100).toFixed(2)}%`;
  const saving = fmt.currency(tax.full_rate * exempt);
  return homestead
    ? `${rate} a year on the price above the ${fmt.currency(exempt)} homestead exemption, from what owner-occupants in ${zip} pay (${years}). As a rental or second home: about ${saving}/yr more.`
    : `${rate} of the full price a year: a rental or second home gets no homestead exemption, about ${saving}/yr more than living here. Rate from what owner-occupants in ${zip} pay (${years}).`;
}

function MonthlyCostPanel({ p, theme, macro, scorecard }) {
  const a = useCostAssumptions(macro?.mortgage_rate_30yr?.value);
  const [costs, setCosts] = useState(null);
  const start = startingPrice(p, scorecard);
  const startPrice = start.price ? Math.round(start.price / 1000) * 1000 : null;
  // undefined = not edited, so the starting price can still fill in if the Scorecard loads late.
  const [userPrice, setUserPrice] = useState(undefined);
  const price = userPrice === undefined ? startPrice : userPrice;
  useEffect(() => {
    getOwnershipCosts().then(setCosts);
  }, []);
  const z = p.zip_code && costs?.zips?.[p.zip_code];
  if (!z) return null;

  const wanted = floodGroup(p);
  const group = z.flood?.[wanted] ? wanted : "all";
  const flood = z.flood?.[group];
  const sfha = p.flood_sfha === true;
  const exempt = costs.homestead_exempt_value ?? HOMESTEAD_EXEMPT_DEFAULT;
  const cost = monthlyCost({
    price,
    downPct: a.down,
    ratePct: a.rate,
    taxAnnual: annualTax(z.tax, price, { homestead: a.homestead, exempt }),
    homeownersAnnual: a.homeowners,
    floodAnnual: a.includeFlood ? flood?.median : 0,
  });
  const notes = {
    pi: `${a.down}% down, ${a.rate}% 30-year fixed.`,
    tax: taxNote(z.tax, p.zip_code, a.homestead, exempt),
    home: `Your estimate, ${fmt.currency(a.homeowners)}/yr. Published 2026 Louisiana averages run ${HOMEOWNERS_RANGE}; get a quote.`,
    flood: !a.includeFlood
      ? sfha
        ? "Not included — but required here with a federally backed mortgage."
        : "Not included."
      : flood
        ? `Median ${FLOOD_GROUP_LABEL[group]} in ${p.zip_code}: ${fmt.currency(flood.median)}/yr (middle half ${fmt.currency(flood.p25)}–${fmt.currency(flood.p75)}, ${fmt.int(flood.policies)} NFIP policies).${sfha ? " Required with a federally backed mortgage." : ""}${group !== wanted ? " Too few policies in this zone class to publish its own figure." : ""}`
        : `Not enough NFIP policies in ${p.zip_code} to publish a figure.`,
  };

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <h3 className="panel-title">Monthly cost to own</h3>
          <div className="panel-subtitle">Loan, property tax and insurance at a purchase price you set. HOA dues and mortgage insurance aren't included.</div>
        </div>
      </div>
      <CostInputs a={a}>
        <label className="field" title="Starts at the ZIP's median sale price">
          Price $<input className="num-input num-input--wide" type="number" step="5000" min="0" value={price ?? ""} onChange={(e) => setUserPrice(e.target.value ? Number(e.target.value) : null)} />
        </label>
      </CostInputs>
      {startPrice && userPrice === undefined && (
        <div className="stat-note" style={{ marginTop: 6 }}>Price starts at {p.zip_code}'s {start.basis}; change it to the price you're considering.</div>
      )}
      {cost ? (
        <table className="cost-table">
          <tbody>
            {COST_PARTS.map((part) => (
              <tr key={part.key}>
                <td>
                  <i className="legend-swatch" style={{ background: seriesColor(part.slot, theme) }} />
                  {part.label}
                  <span className="cost-note">{notes[part.key]}</span>
                </td>
                <td>{fmt.currency(cost[part.key])}/mo</td>
              </tr>
            ))}
            <tr className="cost-total">
              <td>Total</td>
              <td>{fmt.currency(cost.total)}/mo</td>
            </tr>
          </tbody>
        </table>
      ) : (
        <div className="empty" style={{ marginTop: 10 }}>Enter a price to see the monthly cost.</div>
      )}
    </div>
  );
}

// Every stat is { label, value } with value already null when there's nothing to show — a
// section renders only if at least one of its stats survived, so the card never shows a wall
// of "—" placeholders for fields this data source simply doesn't carry (Jefferson's assessor
// feed has no year built, living area or sale history, for instance).
function ParcelCard({ data, trend, theme, navigate, macro, scorecard, onPick }) {
  const p = data.parcel;
  const v = data.valuation;
  const address = p.full_address || p.site_address || p.site_address_norm;

  const sections = [
    [
      "Valuation",
      [
        { label: "Assessor market value", value: p.tot_mkt_val ? fmt.currency(p.tot_mkt_val) : null },
        { label: "Assessed value", value: p.assessed_val != null ? fmt.currency(p.assessed_val) : null },
        { label: "Land value", value: p.land_val != null ? fmt.currency(p.land_val) : null },
        { label: "Building value", value: p.bld_val != null ? fmt.currency(p.bld_val) : null },
        { label: "Homestead exemption", value: p.homestead_exempt_val ? fmt.currency(p.homestead_exempt_val) : null },
        { label: "Taxable value", value: p.taxable_val != null ? fmt.currency(p.taxable_val) : null },
      ],
    ],
    [
      "Property",
      [
        { label: "Year built", value: p.year_built ? fmt.raw(p.year_built) : null },
        { label: "Living area", value: p.building_area ? `${fmt.int(p.building_area)} sq ft` : null },
        { label: "Lot", value: p.land_area ? `${fmt.int(p.land_area)} sq ft` : null },
        { label: "Property class", value: p.property_class || null },
        { label: "Subdivision", value: p.subdivision || null },
        { label: "Zoning", value: p.zoning || null, note: "Parish zoning code" },
      ],
    ],
    [
      "Ownership",
      [
        { label: "Owner", value: p.owner_name ? ownerName(p.owner_name) : null, wide: true },
        lastSale(p),
        { label: "Tax bill #", value: p.tax_bill_number || null },
      ],
    ],
    [
      "ZIP market context",
      [
        { label: "Median home value", value: p.zhvi ? fmtCompactCurrency(p.zhvi) : null },
        { label: "Median sale price", value: p.redfin_median_sale_price ? fmtCompactCurrency(p.redfin_median_sale_price) : null },
      ],
    ],
  ]
    .map(([title, items]) => [title, items.filter((s) => s.value)])
    .filter(([, items]) => items.length > 0);

  const history = (data.value_history || []).map((h) => ({ ...h, monthLabel: String(h.tax_year) }));
  const implied = trend && v ? trend.filter((d) => d.zhvi != null).map((d, _, arr) => ({ monthLabel: monthLabel(d.month), month: d.month, implied: Math.round((d.zhvi / arr[arr.length - 1].zhvi) * v.est_mid) })) : [];

  return (
    <>
      <div className="panel">
        <div className="parcel-header">
          <div>
            <div className="parcel-address">{address}</div>
            <div className="parcel-sub">
              {p.parish === "jefferson" ? "Jefferson Parish" : "Orleans Parish"} · Parcel {p.parcel_id}
            </div>
          </div>
          <div className="parcel-actions">
            <CopyLinkButton address={address} />
          </div>
        </div>
        <FloodZone p={p} />
        {sections.map(([title, items]) => (
          <div key={title} className="stat-section">
            <div className="stat-section-title">{title}</div>
            <div className="stat-grid">
              {items.map((s) => (
                <div key={s.label} className={`stat${s.wide ? " stat--wide" : ""}`}>
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value">{s.value}</div>
                  {s.note && <div className="stat-sub">{s.note}</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {p.legal_description && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-alt)", color: "var(--text-dimmer)", fontSize: 12, overflowWrap: "anywhere" }}>
            Legal: {p.legal_description}
          </div>
        )}
        <div className="method-note" style={{ marginTop: 10 }}>
          Source: {p.parish === "jefferson" ? "Jefferson" : "Orleans"} Parish Assessor, as published
          {p.fetched_at ? ` · pulled ${p.fetched_at.slice(0, 10)}` : ""}.
          {p.zip_code ? " City and ZIP are placed from the parcel's location." : ""} Assessed value is the tax
          value, not a market price.{" "}
          <button type="button" className="link-button" onClick={() => navigate({ view: "about", q: null })}>
            How this data works
          </button>
        </div>
      </div>

      {p.lat != null && p.lng != null && <NearbyMap key={`map-${p.parcel_id}`} p={p} theme={theme} onPick={onPick} />}
      <MonthlyCostPanel key={`cost-${p.parcel_id}`} p={p} theme={theme} macro={macro} scorecard={scorecard} />

      {v && (
        <div className="panel panel--gold">
          <h3 className="panel-title panel-title--gold">Indicative market value</h3>
          <div className="range-stats">
            <div><div className="stat-label">Low</div><div className="range-stat-value">{fmt.currency(v.est_low)}</div></div>
            <div><div className="stat-label">Mid</div><div className="range-stat-value range-stat-value--mid">{fmt.currency(v.est_mid)}</div></div>
            <div><div className="stat-label">High</div><div className="range-stat-value">{fmt.currency(v.est_high)}</div></div>
            {p.tot_mkt_val && <div><div className="stat-label">Assessor market value</div><div className="range-stat-value range-stat-value--ref">{fmt.currency(p.tot_mkt_val)}</div></div>}
          </div>
          <div className="method-note">
            {fmt.int(v.sqft_used)} sq ft × the ZIP's Redfin median sale price per square foot over the last {v.months_used} months
            (25th / 50th / 75th percentile ≈ ${v.ppsf_low} / ${v.ppsf_mid} / ${v.ppsf_high} per sq ft, as of {fmt.monthYear(v.as_of)}).
            A market-level indicator scaled to this home's size — not a professional appraisal; condition, lot and renovations are not considered.
          </div>
        </div>
      )}

      {history.length > 1 && (
        <ChartPanel title="Assessed value history" subtitle="From the assessor's roll, by tax year" rows={history} columns={[{ key: "tax_year", label: "Tax year" }, { key: "tot_mkt_val", label: "Market", type: "currency" }, { key: "assessed_val", label: "Assessed", type: "currency" }]} height={200}>
          <LineChart data={history}>
            <Frame yFormat="currency" yAxis={currencyAxis} series={2} />
            <Line {...lineProps} dataKey="tot_mkt_val" name="Market value" stroke={seriesColor(0, theme)} />
            <Line {...lineProps} dataKey="assessed_val" name="Assessed value" stroke={seriesColor(1, theme)} />
          </LineChart>
        </ChartPanel>
      )}
      {history.length === 1 && (
        <div className="panel">
          <h3 className="panel-title">Assessed value history</h3>
          <Table columns={[{ key: "tax_year", label: "Tax year" }, { key: "land_val", label: "Land", type: "currency" }, { key: "bld_val", label: "Building", type: "currency" }, { key: "tot_mkt_val", label: "Market", type: "currency" }, { key: "assessed_val", label: "Assessed", type: "currency" }]} rows={history} />
        </div>
      )}

      {implied.length > 0 && (
        <ChartPanel title="Implied value history" subtitle="Mid estimate scaled by the ZIP's Zillow home value index" rows={implied} columns={[{ key: "month", label: "Month", type: "monthYear" }, { key: "implied", label: "Implied", type: "currency" }]} height={200}>
          <LineChart data={implied}>
            <Frame yFormat="currency" yAxis={currencyAxis} series={1} />
            <Line {...lineProps} dataKey="implied" name="Implied value" stroke={seriesColor(0, theme)} />
          </LineChart>
        </ChartPanel>
      )}
    </>
  );
}
