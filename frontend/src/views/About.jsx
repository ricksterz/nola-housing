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
  const costs = meta?.sources?.costs || {};
  const flood = meta?.sources?.flood || {};
  const flooded = flood.parcels || 0;
  const floodPulled = flood.pulled_at ? flood.pulled_at.slice(0, 10) : null;

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
          <li><strong>ZIP Scorecard</strong> — all 24 ZIPs side by side with the latest reading, year-over-year change and a 24-month price sparkline. Cell shading is a single blue ramp for magnitude and blue/red for change. Below it: gross rent yield (rent vs. buy) and the true monthly cost of the median sale: loan, property tax, homeowners and flood insurance.</li>
          <li><strong>Compare</strong> — overlay up to six areas on one metric, optionally indexed to 100 so growth can be compared across very different price levels, with small multiples underneath.</li>
          <li><strong>Macro</strong> — metro vs. parish indexes, the 30-year mortgage rate, FHFA house price indexes and realtor.com listing series for the MSA.</li>
          <li><strong>Property Lookup</strong> — parcel records from the parish assessor (owner, assessed value, exemptions, value history, legal description), the FEMA flood zone, a map of the homes around it, the ZIP's market context and a monthly cost to own at a price you set. Copy link shares the page for that address. Currently Jefferson Parish only — see Methodology.</li>
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
          <li><strong>U.S. Census Bureau</strong> — ZIP Code Tabulation Area boundaries, used to place parcels in a ZIP, and American Community Survey 5-year estimates of property taxes paid and home values, used for each ZIP's effective tax rate. Checked monthly, updated when a new 5-year release comes out.</li>
          <li><strong>OpenFEMA NFIP policies</strong> — flood insurance policies in force by ZIP, used for typical flood insurance cost. Monthly.</li>
          <li><strong>OpenStreetMap</strong> — the base map on a property page (© OpenStreetMap contributors). The dots on it are Assessor parcels, placed by each lot's center point.</li>
          <li><strong>FEMA National Flood Hazard Layer</strong> — effective flood zones, placed on each parcel. Monthly.{flooded ? ` ${n(flooded)} parcels${floodPulled ? `, last pulled ${floodPulled}` : ""}.` : ""}</li>
        </ul>
      </div>

      <Collapsible title="Methodology & assumptions" defaultOpen>
        <div className="faq-item">
          <div className="faq-q">Parcel records</div>
          <ul className="text-list">
            <li>Jefferson Parish records come from the Assessor's "Parcel Ownership" GIS layer: owner, site address, land, building and assessed value, exemption, subdivision and legal description, as published. We don't edit values.</li>
            <li>For co-owned parcels the Assessor splits the owner across two fields: the first ends in "&amp;" and the co-owner's name starts the mailing-address line. The co-owner's name is joined back on; the mailing address itself isn't kept or shown. Where no co-owner name can be separated, the card says "&amp; co-owner".</li>
            <li>"How this assessment compares" ranks a parcel's assessed value among similar parcels: the same zoning code (or both unpublished) and both built on or both vacant, so a house is never compared with a store or an empty lot. Two groups: its 50 nearest similar parcels, no farther than about a quarter mile (400 m), and similar parcels in the same subdivision; a group with fewer than 8 isn't shown. It shows where the parcel falls, the median and middle half, and the land and building values side by side. The Assessor doesn't publish living area or condition for Jefferson, so this compares values, not value per square foot. The implied market value is assessed value ÷ 10%, Louisiana's residential assessment ratio.</li>
            <li>Nearby homes are other parcels within about a quarter mile (400 m) of the lot's center point, nearest first, with their assessed value (a tax value, not a price), last qualified sale price when the Assessor publishes one, and flood zone.</li>
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
          <div className="faq-q">Sale price and zoning</div>
          <ul className="text-list">
            <li>The Assessor publishes the last recorded sale price and whether it was a qualified (arm's-length) sale, but not the sale date. We show the price with that flag. Family transfers, donations and successions often record nominal prices and are usually not qualified.</li>
            <li>A $0 price means no sale price is on record, so nothing is shown.</li>
            <li>Zoning is the parish zoning code as published by the Assessor. Check with the parish planning department before relying on it for a permit or a use.</li>
          </ul>
        </div>
        <div className="faq-item">
          <div className="faq-q">Flood zones</div>
          <ul className="text-list">
            <li>Each parcel's lot center is matched against FEMA's effective flood hazard zones. The Assessor's own flood field is filled in for only about 12% of parcels and never has a base flood elevation, so we don't use it.</li>
            <li>Zones A and V (including AE and VE) are special flood hazard areas: a 1% or greater chance of flooding each year. Lenders require flood insurance there on federally backed mortgages.</li>
            <li>Zone X covers moderate-risk areas (0.2% annual chance) and areas FEMA credits with reduced risk because of levees. Levee-protected isn't flood-proof, and FEMA reports more than 20% of flood insurance claims come from outside high-risk areas.</li>
            <li>These are effective maps only; preliminary or pending map changes aren't included. Polygons are simplified to about 1 meter, and a lot is placed by its center, so a parcel on a zone line or a large lot spanning two zones can differ from its official determination.</li>
            <li>A map zone isn't a flood-risk score, an elevation certificate or an insurance quote. Premiums under FEMA's current rating depend on the building, not just the zone.</li>
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
          <div className="faq-q">Monthly cost to own</div>
          <ul className="text-list">
            <li>Principal and interest: a 30-year fixed loan at the rate and down payment you set. The rate starts at the latest Freddie Mac weekly average.</li>
            <li>Property tax: starts from what owner-occupants in the ZIP report paying: total real estate taxes ÷ the total value of their homes, from the Census American Community Survey 5-year estimates{costs.tax_acs_year ? ` (${costs.tax_acs_year - 4}–${costs.tax_acs_year})` : ""}. Nearly all of those owners get Louisiana's homestead exemption on the first $75,000 of value ($7,500 assessed), so that exemption is backed out for every owner-occupied home to get the ZIP's rate on full value.</li>
            <li>A home you'll live in ("I'll live here", the default) is taxed at that rate on the price minus $75,000. A rental or second home gets no homestead exemption and is taxed on the full price, typically $500–$900 a year more here. The rate is an estimate: owners report their own home values and taxes, millage differs within a ZIP (in Harahan, for example, city taxes are added and the homestead exemption doesn't cover them), and senior, veteran and disability exemptions aren't modeled. It's applied to the price you enter, which assumes the home is eventually assessed near that price.</li>
            <li>Flood insurance: the median yearly cost (premium plus fees and surcharges) of single-family, one-year NFIP policies in the ZIP that took effect{costs.flood_period_start ? ` between ${costs.flood_period_start.slice(0, 10)} and ${costs.flood_period_end.slice(0, 10)}` : " in the last 12 months"}, from FEMA's OpenFEMA policy data. On a property, it uses the policies for that parcel's zone class (high-risk A/V or not); the Scorecard uses all policies in the ZIP. A ZIP or zone class with fewer than 20 policies isn't published.</li>
            <li>Existing NFIP policies are still stepping up to full-risk rates (for most primary homes, increases are capped at 18% a year), so a brand-new policy can cost more than the median. NFIP policies can usually be assumed by a buyer. NFIP building coverage tops out at $250,000; private or excess flood coverage costs extra.</li>
            <li>Homeowners (wind and fire) insurance: your estimate. There's no public ZIP-level source. The starting value sits inside the range 2026 insurance-comparison sites publish for Louisiana (about $2,900–$7,300 a year, depending on the source and coverage) and isn't a quote.</li>
            <li>Not included: HOA or condo dues, mortgage insurance on loans with less than 20% down, and maintenance.</li>
            <li>On a property, the price starts at the ZIP's latest median sale price, since the Assessor publishes no market value. The panel appears only for parcels placed in one of the covered ZIPs, because the tax and flood figures are by ZIP.</li>
          </ul>
        </div>
        <div className="faq-item">
          <div className="faq-q">Searching</div>
          <ul className="text-list">
            <li>An address, starting with the house number ("420 Bonnabel"), suggests matching addresses.</li>
            <li>A street name ("Bonnabel", "n causeway") suggests streets. Pick one to see every parcel on it, grouped by block.</li>
            <li>A parcel number (7 or more digits, as on the tax bill) finds that parcel. This is the only way to reach the 10,806 Jefferson parcels the Assessor lists with no street address, and units that share an address with another parcel.</li>
            <li>If an address has no record, the closest house numbers on that street are offered instead.</li>
          </ul>
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
