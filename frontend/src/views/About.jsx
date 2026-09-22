import Collapsible from "../components/Collapsible";

export default function About({ ctx }) {
  const rw = ctx.meta?.refresh_windows;
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
          <li><strong>Macro</strong> — metro vs. parish indexes, and once the FRED feed is on: the 30-year mortgage rate, FHFA house price indexes and realtor.com listing series for the MSA.</li>
          <li><strong>Property Lookup</strong> — parcel records from the parish assessors (owner, assessed and market value, exemptions, value history) plus an indicative value from the ZIP's $/sqft.</li>
        </ul>
      </div>

      <div className="panel">
        <h3 className="panel-title">Data sources & cadence</h3>
        <ul className="text-list">
          <li><strong>Redfin Data Center</strong> — county, metro and ZIP market trackers (median sale price, homes sold, DOM, inventory, price drops, sale-to-list). Monthly.</li>
          <li><strong>Zillow Research</strong> — ZHVI (typical home value) and ZORI (typical asking rent) at metro, parish and ZIP level. Monthly.</li>
          <li><strong>FRED</strong> — Freddie Mac 30-year rate, FHFA all-transactions HPI for the New Orleans–Metairie MSA (quarterly) and for Jefferson and Orleans Parish (annual), realtor.com listing series. Monthly.</li>
          <li><strong>Jefferson Parish Assessor</strong> — annually, after the Aug 15 – Sep 15 inspection period{rw?.jefferson ? ` (window ${rw.jefferson.start} – ${rw.jefferson.end})` : ""}.</li>
          <li><strong>Orleans Parish Assessor</strong> — during the Jul 15 – Aug 15 open-rolls window and again after it closes{rw?.orleans ? ` (window ${rw.orleans.start} – ${rw.orleans.end})` : ""}.</li>
        </ul>
      </div>

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
          <p className="text-block">The public records of the Jefferson Parish and Orleans Parish Assessors. The pipeline checks each parish's official bulk data first and otherwise reads the public search site slowly and politely, on the assessment calendar. Owner names are public record in Louisiana.</p>
        </div>
      </Collapsible>
    </div>
  );
}
