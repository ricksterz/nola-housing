const SOURCES = [
  { name: "Jefferson Parish Assessor", href: "https://www.jpassessor.net/", desc: "Public parcel records: owner, assessed and market value, legal description" },
  { name: "Orleans Parish Assessor", href: "https://nolaassessor.com/", desc: "Public parcel records: owner, assessed value, tax bill number" },
  { name: "City of New Orleans", href: "https://data.nola.gov/", desc: "ParcelSearch GIS layer (the Assessor's owners and tax bills) and address points, from gis.nola.gov and data.nola.gov" },
  { name: "FEMA", href: "https://www.fema.gov/flood-maps/national-flood-hazard-layer", desc: "National Flood Hazard Layer flood zones, and NFIP policy costs from OpenFEMA" },
  { name: "Redfin", href: "https://www.redfin.com/news/data-center/", desc: "County, metro and ZIP market statistics © Redfin, a national real estate brokerage" },
  { name: "Zillow", href: "https://www.zillow.com/research/data/", desc: "Zillow Home Value Index (ZHVI) and Observed Rent Index (ZORI) from Zillow Research: smoothed index estimates, not appraisals" },
  { name: "FRED®", href: "https://fred.stlouisfed.org/", desc: "Federal Reserve Economic Data, Federal Reserve Bank of St. Louis: FHFA house price indexes, the Freddie Mac 30-year mortgage average and realtor.com listing series (sources cited on the Macro tab)" },
  { name: "U.S. Census Bureau", href: "https://www.census.gov/programs-surveys/acs", desc: "ZIP Code Tabulation Areas and American Community Survey 5-year estimates (property tax rates)" },
  { name: "OpenStreetMap", href: "https://www.openstreetmap.org/copyright", desc: "Base maps © OpenStreetMap contributors" },
  { name: "AI & Power tracker", desc: "Compiled by hand from news reports, company releases and Louisiana Public Service Commission filings, each linked where it's used" },
];

const TERMS =
  "Terms: DOM — days on market · HPI — house price index · MSA — metropolitan statistical area · ZHVI — Zillow Home Value Index · " +
  "ZORI — Zillow Observed Rent Index · gross yield — annual rent ÷ home value · months of supply — active listings ÷ monthly sales";

export default function Footer({ generated, sources }) {
  const day = (iso) => (iso ? iso.slice(0, 10) : null);
  const fredDay = day(sources?.fred?.fetched_at);
  const femaDay = day(sources?.costs?.flood_pulled_at);
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-heading">Disclaimer</div>
        <p style={{ margin: "0 0 10px" }}>
          This site is provided for general informational and educational purposes only. Nothing here constitutes
          financial, investment, legal, or tax advice, an offer to buy or sell real estate, or a professional
          appraisal or broker price opinion. Automated value indexes and aggregated market statistics are estimates
          and may differ materially from the actual value or condition of any individual property. Consult a
          licensed real estate professional, appraiser, or financial advisor before making decisions based on this
          information.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          Data is drawn from third-party and public-record sources, is provided “as is” without warranty of any
          kind, and may be incomplete, delayed, or contain errors. Parcel records reflect the public files of the
          Jefferson and Orleans Parish Assessors at the time of export and may not reflect current ownership,
          valuation, or condition.
          {generated && <> Data snapshot generated {generated.slice(0, 10)}.</>}
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <b>Owner names and property records.</b> Owner names, addresses and other parcel details are copied as
          published from public records of the Jefferson Parish Assessor, the Orleans Parish Assessor and the City of
          New Orleans, which are public under Louisiana's Public Records Law. They are not verified by this site, and
          there is no guarantee that any owner name, ownership listing or property record is accurate, complete or
          current: the rolls lag sales, inheritances and other transfers, can contain errors, and may still name a
          former owner. Properties are grouped under an owner by matching the name as written, so an owner page or name
          search may combine different people or businesses who share a name, and may miss properties listed under
          another spelling or entity. Nothing here is a title search, legal description of ownership or proof of who
          owns a property; for legal, lending or tax purposes rely on the parish Clerk of Court's conveyance and
          mortgage records and the Assessor's official records. To correct a record, contact the Assessor's office;
          corrections made there appear here after the next refresh. Don't use this information to harass, threaten
          or discriminate against anyone.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <b>Usage counts.</b> Visits are counted with Google Analytics, which sets cookies, and Cloudflare Web
          Analytics, which doesn't. They receive which pages and features are used, never the addresses, names or
          parcel numbers you search for. Browsers that send Global Privacy Control aren't counted by Google
          Analytics; you can also opt out with Google's opt-out browser add-on or an ad blocker.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <b>School Finder and FloodLens</b> are separate sites by the same independent builder, linked from the home
          page and opened in a new tab. Each has its own sources, methods and notes; FloodLens's flood score is a
          model, not a FEMA determination or an insurance quote.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          This site is an independent project and is not affiliated with, endorsed by, or sponsored by either
          Parish Assessor, the City of New Orleans, FEMA, the U.S. Census Bureau, Zillow, Redfin, realtor.com,
          Freddie Mac, the Federal Reserve Bank of St. Louis, OpenStreetMap, the Louisiana Public Service Commission,
          Entergy or Meta. All trademarks are the property of their respective owners.
        </p>
        <p style={{ margin: "0 0 14px" }}>
          This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis
          {fredDay && <> (retrieved {fredDay})</>}. Use of FRED data is subject to the{" "}
          <a href="https://fred.stlouisfed.org/docs/api/terms_of_use.html" target="_blank" rel="noreferrer">FRED® API Terms of Use</a>.
          This product uses the Federal Emergency Management Agency’s OpenFEMA API, but is not endorsed by FEMA. The
          Federal Government or FEMA cannot vouch for the data or analyses derived from these data after the data have
          been retrieved from the Agency's website(s). Flood insurance costs use the{" "}
          <a href="https://www.fema.gov/openfema-data-page/fima-nfip-redacted-policies-v2" target="_blank" rel="noreferrer">FIMA NFIP Redacted Policies v2</a>{" "}
          dataset (www.fema.gov/api/open/v2/FimaNfipPolicies){femaDay && <>, retrieved {femaDay}</>}.
        </p>
        <div className="footer-sources">
          {SOURCES.map(({ name, href, desc }) => (
            <span key={name}>
              <b>{href ? <a href={href} target="_blank" rel="noreferrer">{name}</a> : name}</b>
              {" — "}
              {desc}
            </span>
          ))}
        </div>
        <p style={{ margin: "12px 0 0", color: "var(--text-dimmer)" }}>{TERMS}</p>
      </div>
    </footer>
  );
}
