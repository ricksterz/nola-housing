import { useEffect, useState } from "react";
import { claimsText, elevationText, getFloodLens } from "../lib/floodlens";
import { floodLensLink } from "../lib/links";
import { EVENTS, trackEvent } from "../lib/metrics";

// FloodLens's facts for this spot, inside the flood card: ground elevation, levee, storm surge and
// past claims nearby. Read live (lib/floodlens.js), so it says when it's waiting on a cold start
// and falls back to the plain link if FloodLens doesn't answer. Facts only, worded as FloodLens
// words them; no score and no ranking of one risk against another.
export default function FloodLensDetails({ p }) {
  const [state, setState] = useState({ status: "loading" });
  const [slow, setSlow] = useState(false);
  const link = floodLensLink(p.full_address || `${p.lat},${p.lng}`);

  useEffect(() => {
    // The parent keys this component by location, so each spot starts from the loading state.
    let live = true;
    const t = setTimeout(() => live && setSlow(true), 4000);
    getFloodLens(p.lat, p.lng)
      .then((d) => live && setState({ status: "ok", d }))
      .catch(() => {
        if (!live) return;
        trackEvent(EVENTS.floodlensInlineError);
        setState({ status: "error" });
      })
      .finally(() => clearTimeout(t));
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [p.lat, p.lng]);

  const open = (
    <a href={link} target="_blank" rel="noreferrer" onClick={() => trackEvent(EVENTS.openFloodLens)}>
      Full flood report in FloodLens ↗
    </a>
  );

  if (state.status === "loading") {
    return (
      <div className="floodlens-live" aria-live="polite">
        <div className="floodlens-live-title">Elevation, levees, storm surge and past claims</div>
        <div className="flood-detail">
          <span className="floodlens-spinner" aria-hidden="true" />
          {slow ? "Waking FloodLens up. On a first visit this can take up to a minute…" : "Checking FloodLens…"}
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="floodlens-live">
        <div className="flood-detail">FloodLens didn't answer just now. {open}</div>
      </div>
    );
  }

  const d = state.d;
  const rows = [
    ["Ground elevation", elevationText(d.elevation_ft), "USGS, NAVD88 datum. Ground at the lot, not the floor of the house."],
    ["Levee", d.levee?.status && d.levee.status !== "unknown" ? d.levee.headline : null, null],
    ["Hurricane storm surge", d.surge?.status && d.surge.status !== "unavailable" ? d.surge.headline : null, null],
    ["Past flood claims", claimsText(d.claims_history), d.claims_history?.claims_through ? `FEMA NFIP claims on record through ${d.claims_history.claims_through}. An area count, not this house's history.` : null],
  ].filter(([, v]) => v);

  return (
    <div className="floodlens-live">
      <div className="floodlens-live-title">From FloodLens</div>
      {rows.length > 0 ? (
        <dl className="floodlens-facts">
          {rows.map(([label, value, note]) => (
            <div key={label} className="floodlens-fact">
              <dt>{label}</dt>
              <dd>
                {value}
                {note && <span className="floodlens-fact-note">{note}</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flood-detail">FloodLens has no elevation, levee, surge or claims data for this spot.</div>
      )}
      <div className="method-note" style={{ marginTop: 6 }}>
        Drainage and pump stations, the levee map and surge by hurricane category: {open}
      </div>
    </div>
  );
}
