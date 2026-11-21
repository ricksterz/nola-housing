import { useEffect, useState } from "react";
import { claimsText, elevationText, floodScore, getFloodLens } from "../lib/floodlens";
import { floodLensLink } from "../lib/links";
import { EVENTS, trackEvent } from "../lib/metrics";

// FloodLens inside the flood card, under the FEMA zone: its 0-100 score, labeled as a model estimate
// validated only inside FEMA A zones, then its facts for the spot (ground elevation, levee, storm
// surge, past claims nearby), worded as FloodLens words them, with no ranking of one risk against
// another. Read live (lib/floodlens.js), so it says when it's waiting on a cold start and falls back
// to the plain link if FloodLens doesn't answer.
function FloodLensScore({ d, inAZone }) {
  const s = floodScore(d);
  // The README's FloodLens rules hold in both forms: always a model estimate, validated only in
  // FEMA A zones, with its input coverage and a preliminary map named when they apply.
  const caveats = s && (
    <>
      {s.coverage != null && ` Based on ${Math.round(s.coverage * 100)}% of the model's inputs; the rest have no data here.`}
      {s.prelimDate && ` Scored on FEMA's preliminary map (issued ${s.prelimDate}), which isn't in effect and isn't for insurance.`}
    </>
  );
  // Outside an A zone the score is untested, so it is one small line, not a headline number.
  if (!inAZone) {
    return (
      <div className="floodlens-score floodlens-score--minor">
        {s ? (
          <>
            {`FloodLens model score ${s.score}/100${s.label ? ` (${s.label.toLowerCase()})` : ""}: untested outside FEMA A zones, so not a reading of this address's risk. A model estimate, not a FEMA determination or an insurance quote.`}
            {caveats}
          </>
        ) : (
          "FloodLens has too little data here to give a model score."
        )}
      </div>
    );
  }
  if (!s) {
    return (
      <div className="floodlens-score">
        <div className="floodlens-live-title">FloodLens score</div>
        <div className="flood-detail">Not scored: FloodLens has too little data for this spot to give one.</div>
      </div>
    );
  }
  return (
    <div className="floodlens-score">
      <div className="floodlens-live-title">FloodLens score · model estimate</div>
      <div className="floodlens-score-value">
        <b>{s.score}</b> / 100{s.label && <span className="floodlens-score-label">{s.label}</span>}
      </div>
      <span className="floodlens-fact-note">
        {"A model's estimate, not a FEMA determination or an insurance quote. FloodLens's backtest against flood insurance claims validated it only inside FEMA A zones, which this address is in."}
        {caveats}
      </span>
    </div>
  );
}

export default function FloodLensDetails({ p }) {
  const [state, setState] = useState({ status: "loading" });
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const link = floodLensLink(p.full_address || `${p.lat},${p.lng}`);

  useEffect(() => {
    // The parent keys this component by location, so each spot starts from the loading state.
    let live = true;
    const t = setTimeout(() => live && setSlow(true), 4000);
    // One quiet retry before saying anything: a sleeping host or a dropped connection usually
    // answers the second time. getFloodLens drops a failed lookup from its cache, so this refetches.
    getFloodLens(p.lat, p.lng)
      .catch(() => (live ? getFloodLens(p.lat, p.lng) : Promise.reject()))
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
  }, [p.lat, p.lng, attempt]);

  function retry() {
    setState({ status: "loading" });
    setSlow(false);
    setAttempt((n) => n + 1);
  }

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
    // Quiet on purpose: the FEMA zone above already answers the main question.
    return (
      <div className="floodlens-live" aria-live="polite">
        <div className="method-note">
          Flood details from FloodLens are taking longer than usual.{" "}
          <button type="button" className="link-button" onClick={retry}>
            Try again
          </button>
          {" · "}
          {open}
        </div>
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
      <FloodLensScore d={d} inAZone={/^A/i.test(p.flood_zone || "")} />
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
