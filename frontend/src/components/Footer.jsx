import { legal, legalValues } from "../lib/legal";

const LEGAL = legalValues();

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

// Pages that left the main bar (App.jsx) still need a way in from every page.
const FOOTER_LINKS = [
  ["power", "/power/", "AI data centers and your power bill"],
  ["about", "/about/", "About, sources and methods"],
  ["terms", "/terms/", "Terms of Use"],
  ["privacy", "/privacy/", "Privacy Policy"],
];

/** A link to one of the site's own pages that opens in the app (or a new tab with a modifier key). */
function FooterLink({ view, navigate, children }) {
  return (
    <a
      href={`/${view}/`}
      onClick={(e) => {
        if (!navigate || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate({ view, q: null, street: null, owner: null, geo: null });
        window.scrollTo({ top: 0 });
      }}
    >
      {children}
    </a>
  );
}

export default function Footer({ generated, sources, navigate }) {
  const day = (iso) => (iso ? iso.slice(0, 10) : null);
  const fredDay = day(sources?.fred?.fetched_at);
  const femaDay = day(sources?.costs?.flood_pulled_at);
  return (
    <footer className="footer">
      <div className="footer-inner">
        <nav className="footer-links" aria-label="More from NOLA Atlas">
          {FOOTER_LINKS.map(([view, , label]) => (
            <FooterLink key={view} view={view} navigate={navigate}>
              {label}
            </FooterLink>
          ))}
        </nav>
        <div className="footer-heading">Disclaimer</div>
        <p style={{ margin: "0 0 10px" }}>
          General information only: not financial, legal, tax, insurance or real estate advice, an appraisal, a title
          search or an official FEMA flood zone determination. Data comes from public records and other sources “as
          is”, isn&apos;t verified and may be wrong or out of date.
          {generated && <> Data snapshot generated {generated.slice(0, 10)}.</>} See the{" "}
          <FooterLink view="terms" navigate={navigate}>Terms of Use</FooterLink>.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <b>Owner names</b> are copied from the Assessors&apos; rolls and may name a former owner; they aren&apos;t
          proof of ownership (the Clerk of Court&apos;s records are). NOLA Atlas is not a consumer reporting agency:
          don&apos;t use it for decisions about credit, insurance, employment or housing, or to harass or
          discriminate against anyone.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <b>Usage counts.</b> Google Analytics (with cookies) and Cloudflare Web Analytics count page and feature
          use, never the addresses, names or parcel numbers you search for. See the{" "}
          <FooterLink view="privacy" navigate={navigate}>Privacy Policy</FooterLink>.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <b>School Finder and FloodLens</b> are separate sites {LEGAL.same_operator}. FloodLens&apos;s flood score is a
          model estimate, not a FEMA determination or an insurance quote.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          NOLA Atlas is an independent project{legal.operator ? ` of ${legal.operator}` : ""} and is not affiliated with, endorsed by, or sponsored by either
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
        <p className="footer-operator">
          {`© ${legal.copyright_year} ${LEGAL.owner}.${legal.operator_full ? ` NOLA Atlas is operated by ${legal.operator_full}.` : ""}`}
          {legal.contact && (
            <>
              {" Contact: "}
              <a href={`mailto:${legal.contact}`}>{legal.contact}</a>
            </>
          )}
        </p>
      </div>
    </footer>
  );
}
