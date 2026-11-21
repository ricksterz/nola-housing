import { useEffect, useState } from "react";
import { claimsText, elevationText, floodScore, getFloodLens } from "../lib/floodlens";
import { floodLensLink } from "../lib/links";
import { EVENTS, trackEvent } from "../lib/metrics";

// FloodLens inside the flood card, under the FEMA zone, kept compact: one row of short facts
// (ground elevation, levee, storm surge, past claims nearby), with FloodLens's full wording, its
// sources and the card's caveats folded into one "Details and sources" toggle. Its 0-100 score is a
// headline tile only inside a FEMA A zone, where its backtest validated it; elsewhere it is one
// small line inside the toggle that says it's untested there (README "FloodLens tracts"). Read live
// (lib/floodlens.js), so it says when it's waiting on a cold start and falls back to the plain link.

const LEVEE = {
  behind_accredited_levee: ["Accredited levee", "FEMA-mapped protection"],
  behind_provisionally_accredited_levee: ["Provisional levee", "accreditation not final"],
  not_levee_protected: ["Not levee-protected", "on FEMA's map"],
};

function surgeTile(s) {
  if (s?.status === "surge_mapped" && s.first_category) return [`From Cat ${s.first_category}`, "hurricane surge mapped"];
  if (s?.status === "leveed_area") return ["Leveed area", "NHC shows no depth"];
  if (s?.status === "none_mapped") return ["None mapped", "any hurricane category"];
  return null;
}

function elevationTile(feet) {
  if (feet == null || !Number.isFinite(feet)) return null;
  if (Math.abs(feet) < 0.05) return ["0 ft", "at sea level"];
  return [`${Math.abs(feet).toFixed(1)} ft`, feet > 0 ? "above sea level" : "below sea level"];
}

function claimsTile(h) {
  if (h?.status === "no_claims_on_record") return ["None", "claims on record in tract"];
  if (h?.status !== "ok") return null;
  const n = h.claims_since_window_start;
  return [n.toLocaleString(), `claim${n === 1 ? "" : "s"} in tract since ${h.window_start}`];
}

/** The A-zone score tile, or null (outside an A zone the score lives in the details as one line). */
function scoreTile(s, inAZone) {
  if (!inAZone) return null;
  if (!s) return { label: "FloodLens score", value: "Not scored", sub: "too little data here" };
  return {
    label: "FloodLens score",
    value: `${s.score}/100`,
    sub: [s.label, "model estimate", s.coverage != null && `${Math.round(s.coverage * 100)}% of inputs`].filter(Boolean).join(" · "),
  };
}

function scoreNote(s, inAZone) {
  const caveats = s
    ? `${s.coverage != null ? ` Based on ${Math.round(s.coverage * 100)}% of the model's inputs; the rest have no data here.` : ""}${
        s.prelimDate ? ` Scored on FEMA's preliminary map (issued ${s.prelimDate}), which isn't in effect and isn't for insurance.` : ""
      }`
    : "";
  if (!inAZone) {
    return s
      ? `FloodLens model score ${s.score}/100${s.label ? ` (${s.label.toLowerCase()})` : ""}: untested outside FEMA A zones, so not a reading of this address's risk. A model estimate, not a FEMA determination or an insurance quote.${caveats}`
      : "FloodLens has too little data here to give a model score.";
  }
  return s
    ? `FloodLens score: a model's estimate, not a FEMA determination or an insurance quote. Its backtest against flood insurance claims validated it only inside FEMA A zones, which this address is in.${caveats}`
    : "FloodLens score: not scored, because FloodLens has too little data for this spot to give one.";
}

export default function FloodLensDetails({ p, notes }) {
  const [state, setState] = useState({ status: "loading" });
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const link = floodLensLink(p.full_address || `${p.lat},${p.lng}`);
  const inAZone = /^A/i.test(p.flood_zone || "");

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
      Full report in FloodLens ↗
    </a>
  );

  let body;
  let detailNotes = [];
  if (state.status === "loading") {
    body = (
      <div className="flood-detail" aria-live="polite">
        <span className="floodlens-spinner" aria-hidden="true" />
        {slow ? "Waking FloodLens up for elevation, levee and surge. A first visit can take up to a minute…" : "Checking FloodLens…"}
      </div>
    );
  } else if (state.status === "error") {
    // Quiet on purpose: the FEMA zone above already answers the main question.
    body = (
      <div className="method-note" aria-live="polite">
        FloodLens is taking longer than usual.{" "}
        <button type="button" className="link-button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  } else {
    const d = state.d;
    const s = floodScore(d);
    const levee = d.levee?.status && LEVEE[d.levee.status];
    const tiles = [
      scoreTile(s, inAZone),
      ...[
        ["Ground elevation", elevationTile(d.elevation_ft)],
        ["Levee", levee],
        ["Storm surge", surgeTile(d.surge)],
        ["Past claims", claimsTile(d.claims_history)],
      ]
        .filter(([, t]) => t)
        .map(([label, [value, sub]]) => ({ label, value, sub })),
    ].filter(Boolean);
    body =
      tiles.length > 0 ? (
        <dl className="flood-tiles">
          {tiles.map((t) => (
            <div key={t.label} className="flood-tile">
              <dt>{t.label}</dt>
              <dd>
                <b>{t.value}</b>
                {t.sub && <span>{t.sub}</span>}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <div className="flood-detail">FloodLens has no elevation, levee, surge or claims data for this spot.</div>
      );
    detailNotes = [
      scoreNote(s, inAZone),
      elevationText(d.elevation_ft) && `Ground elevation: ${elevationText(d.elevation_ft)} (USGS, NAVD88 datum). Ground at the lot, not the floor of the house.`,
      levee && d.levee.headline && `Levee: ${d.levee.headline}`,
      surgeTile(d.surge) && d.surge.headline && `Storm surge: ${d.surge.headline}`,
      claimsText(d.claims_history) &&
        `Past claims: ${claimsText(d.claims_history)}${d.claims_history.claims_through ? ` FEMA NFIP claims on record through ${d.claims_history.claims_through}. An area count, not this house's history.` : ""}`,
    ].filter(Boolean);
  }

  return (
    <div className="floodlens-live">
      {body}
      <details className="flood-more">
        <summary>Details and sources</summary>
        <div className="flood-more-body">
          {notes}
          {detailNotes.map((n) => (
            <p key={n.slice(0, 24)}>{n}</p>
          ))}
          <p>Drainage and pump stations, the levee map and surge by hurricane category: {open}</p>
        </div>
      </details>
    </div>
  );
}
