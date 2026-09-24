import Collapsible from "../components/Collapsible";

const n = (v) => (v == null ? "—" : Number(v).toLocaleString());

export default function About({ ctx }) {
  const meta = ctx.meta;
  const rw = meta?.refresh_windows;
  const a = meta?.sources?.assessor || {};
  const parcels = a.parcels || 0;
  const geocoded = a.geocoded ?? null;
  const addresses = meta?.property_count ?? null;
  const pulled = a.fetched_at ? a.fetched_at.slice(0, 10) : null;
  const shared = parcels && addresses != null ? parcels - addresses : null;

  return (
    <div>
      <div className="panel">
        <h3 className="panel-title">About NOLA Housing Pulse</h3>
        <p className="text-block">
          NOLA Housing Pulse is a free, independent reference for home values, rents and market trends across Metairie,
          Old Metairie and New Orleans — every residential ZIP in Jefferson and Orleans Parish. It is built by a
          local resident, not a brokerage, on public data, and refreshes automatically: market feeds monthly, parcel
          records on each parish assessor's calendar.
        </p>
        <p className="text-block">
          Nothing here is an appraisal, a comparative market analysis, or advice. Use it to understand your ZIP's
          market, then talk to a licensed professional about a specific home.
        </p>
      </div>

      <div className="panel">
        <h3 className="panel-title">What each view shows</h3>
        <ul className="text-list">
          <li><strong>Market Overview</strong> — one area at a time: home value (Zillow ZHVI) vs. median sale price (Redfin), rent (ZORI), days on market, listings pipeline, inventory, months of supply, $/sqft and negotiation metrics. Every chart has a table view.</li>
          <li><strong>ZIP Scorecard</strong> — all 24 ZIPs side by side with the latest reading, year-over-year change and a 24-month price sparkline. Cell shading is a single blue ramp for magnitude and blue/red for change. Below it: gross rent yield (rent vs. buy) and the monthly payment on the median sale at a rate you set.</li>
          <li><strong>Compare</strong> — overlay up to six areas on one metric, optionally indexed to 100 so growth can be compared across very different price levels, with small multiples underneath.</li>
          <li><strong>Macro</strong> — metro vs. parish indexes, the 30-year mortgage rate, FHFA house price indexes and realtor.com listing series for the MSA.</li>
          <li><strong>Property Lookup</strong> — parcel records from the parish assessor (owner, assessed value, exemptions, value history, legal description) and the ZIP's market context. Currently Jefferson Parish only — see Methodology.</li>
        </ul>
      </div>

      <div className="panel">
        <h3 className="panel-title">Data sources & cadence</h3>
        <ul className="text-list">
          <li><strong>Redfin Data Center</strong> — county, metro and ZIP market trackers (median sale price, homes sold, DOM, inventory, price drops, sale-to-list). Monthly.</li>
          <li><strong>Zillow Research</strong> — ZHVI (typical home value) and ZORI (typical asking rent) at metro, parish and ZIP level. Monthly.</li>
          <li><strong>FRED</strong> — Freddie Mac 30-year rate, FHFA all-transactions HPI for the New Orleans–Metairie MSA (quarterly) and for Jefferson and Orleans Parish (annual), realtor.com listing series. Monthly.</li>
          <li><strong>Jefferson Parish Assessor</strong> — the Assessor's Office public GIS parcel-ownership layer, pulled daily through the Aug 15 – Sep 30 inspection and certification period{rw?.jefferson ? ` (window ${rw.jefferson.start} – ${rw.jefferson.end})` : ""}.{parcels ? ` ${n(parcels)} parcels${pulled ? `, last pulled ${pulled}` : ""}.` : ""}</li>
          <li><strong>Orleans Parish Assessor</strong> — not loaded yet. Scheduled for the Jul 15 – Aug 15 open-rolls window{rw?.orleans ? ` (window ${rw.orleans.start} – ${rw.orleans.end})` : ""}; see Methodology for why.</li>
          <li><strong>U.S. Census Bureau</strong> — ZIP Code Tabulation Area boundaries, used to place parcels in a ZIP.</li>
        </ul>
      </div>

      <Collapsible title="Methodology & assumptions" defaultOpen>
        <div className="faq-item">
          <div className="faq-q">Parcel records</div>
          <ul className="text-list">
            <li>Jefferson Parish records come from the Assessor's "Parcel Ownership" GIS layer: owner, site address, land, building and assessed value, exemption, subdivision and legal description, as published. We don't edit values.</li>
            <li>Records are labeled with the year they were pulled. The values are whatever roll the Assessor has published to that layer, which may lag a newly certified roll.</li>
            <li>Orleans Parish has no parcel records here yet. The City's public GIS layers carry parcel IDs and addresses but no assessed values, so Orleans data will come from the Assessor's own site in a later release.</li>
          </ul>
        </div>
        <div className="faq-item">
          <div className="faq-q">Addresses, city and ZIP</div>
          <ul className="text-list">
            <li>The Assessor's layer doesn't include a usable city or ZIP. We place each parcel by the center of its lot and match it against Census ZIP Code Tabulation Area boundaries (2010 vintage) for the 24 ZIPs this site covers.{geocoded != null && parcels ? ` ${n(geocoded)} of ${n(parcels)} Jefferson parcels fall inside them.` : ""}</li>
            <li>Parcels outside those ZIPs (the West Bank, Kenner and other parts of the parish this site doesn't cover) show the street address only. We don't guess a ZIP.</li>
            <li>Tabulation areas approximate USPS delivery areas. A parcel right on a boundary can be assigned to the neighboring ZIP.</li>
            <li>The city is the USPS city for that ZIP (70005 → Metairie, 70123 → Harahan), not a neighborhood name.</li>
            <li>When several parcels share one street address (condos, multi-unit lots), Property Lookup shows only one of them{shared ? ` (about ${n(shared)} parcels are affected)` : ""}.</li>
          </ul>
        </div>
        <div className="faq-item">
          <div className="faq-q">Assessed value, market value and exemptions</div>
          <ul className="text-list">
            <li>Assessed value is set by the Assessor for tax purposes. Louisiana assesses land and homes at 10% of fair market value and commercial buildings at 15%, so market value isn't simply assessed × 10, and we don't compute it. "Assessor market value" appears only when the source publishes it.</li>
            <li>Exemptions are shown as published. The standard homestead exemption is $7,500 of assessed value ($75,000 of market value). For tax-exempt owners such as churches and nonprofits, the figure can equal the full assessed value.</li>
            <li>Fields the source doesn't carry, such as year built, living area and sale date, are left off the record rather than shown blank.</li>
          </ul>
        </div>
        <div className="faq-item">
          <div className="faq-q">Indicative value</div>
          <p className="text-block">Living area × the ZIP's Redfin median sale price per square foot, shown as the 25th–75th percentile of the last 12 months. It needs a living area and a covered ZIP. Jefferson's parcel layer has no living area, so this estimate doesn't appear for Jefferson parcels today. It's a market-level figure, not an appraisal: condition, lot, flood elevation and renovations aren't considered.</p>
        </div>
        <div className="faq-item">
          <div className="faq-q">Market data</div>
          <ul className="text-list">
            <li>Redfin figures are rolling three-month measures by sale month. ZIPs with only a few sales a month swing more.</li>
            <li>ZHVI is Zillow's smoothed, seasonally adjusted typical value for mid-tier homes (roughly the 35th–65th percentile). ZORI is a smoothed typical asking rent, published only where there are enough listings.</li>
            <li>Year-over-year compares the latest month with the same month a year earlier.</li>
          </ul>
        </div>
        <div className="faq-item">
          <div className="faq-q">Affordability</div>
          <p className="text-block">The monthly payment is principal and interest only on the ZIP's median sale price, as a 30-year fixed loan at the rate and down payment you set. It leaves out property tax, homeowners and flood insurance, HOA dues and mortgage insurance, and in this region insurance can be a large share of the real monthly cost.</p>
        </div>
        <div className="faq-item">
          <div className="faq-q">Searching</div>
          <p className="text-block">Search matches from the start of the address, so start with the house number ("420 Bonnabel"). A street name alone won't return results.</p>
        </div>
      </Collapsible>

      <Collapsible title="Frequently asked questions" defaultOpen>
        <div className="faq-item">
          <div className="faq-q">Why do Zillow's value and Redfin's median sale price disagree?</div>
          <p className="text-block">ZHVI estimates the typical value of <em>all</em> homes in an area, smoothed and seasonally adjusted. Redfin's median sale price is only the homes that actually sold in a rolling three-month window, so it swings with the mix of what sold. Read ZHVI for level and trend, Redfin for what the market is clearing at right now.</p>
        </div>
        <div className="faq-item">
          <div className="faq-q">What is gross rent yield?</div>
          <p className="text-block">Typical annual rent divided by typical home value, before taxes, insurance, vacancy and upkeep. It is a quick rent-vs-buy gauge across ZIPs, not a return forecast — flood insurance alone can move the real number a lot in this region.</p>
        </div>
        <div className="faq-item">
          <div className="faq-q">Why is a ZIP missing rent data?</div>
          <p className="text-block">Zillow publishes ZORI only where it has enough rental listings; a couple of ZIPs fall below that threshold.</p>
        </div>
        <div className="faq-item">
          <div className="faq-q">Where do the parcel records come from?</div>
          <p className="text-block">The Jefferson Parish Assessor's public GIS parcel layer, pulled on the assessment calendar. Owner names, addresses and assessed values are public record in Louisiana and are published by the Assessor.</p>
        </div>
        <div className="faq-item">
          <div className="faq-q">My address isn't found. Why?</div>
          <p className="text-block">It may be in Orleans Parish (not loaded yet), outside the ZIPs this site covers, or sharing a street address with another parcel. Try starting with the house number and just the first part of the street name.</p>
        </div>
      </Collapsible>
    </div>
  );
}
