// FloodLens, read live from the property report. FloodLens is a separate service on a free host
// that sleeps when idle, so the first request after a quiet spell can take up to a minute.
//
// The report shows FloodLens's 0-100 score under the FEMA zone, always labeled as a model estimate
// validated only inside FEMA A zones (README "FloodLens tracts"), then its facts for the spot
// (ground elevation, levee, storm surge, past insurance claims in the census tract).
import { FLOODLENS_URL } from "./links.js";

// `?.`: import.meta.env exists only under Vite; the unit tests (node --test) import this file directly.
const API = (import.meta.env?.VITE_FLOODLENS_API || FLOODLENS_URL).replace(/\/$/, "");
const TIMEOUT_MS = 90_000; // a cold start plus a full lookup
const cache = new Map();

/** The FloodLens lookup for a point; one request per point per visit. Rejects on failure. */
export function getFloodLens(lat, lng) {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  const p = fetch(`${API}/api/lookup/coords?${new URLSearchParams({ lat: lat.toFixed(6), lng: lng.toFixed(6) })}`, { signal: ctl.signal })
    .then((r) => {
      if (!r.ok) throw new Error(`FloodLens answered ${r.status}`);
      return r.json();
    })
    .finally(() => clearTimeout(timer));
  cache.set(key, p);
  p.catch(() => cache.delete(key));
  return p;
}

let woken = false;
/** Nudge FloodLens awake while the reader is still typing, so the report doesn't wait as long.
 *  Fire-and-forget: no-cors, so the answer is never read and nothing can fail visibly. */
export function wakeFloodLens() {
  if (woken || typeof fetch === "undefined") return;
  woken = true;
  fetch(`${API}/api/health`, { mode: "no-cors" }).catch(() => {});
}

const RISK_LABEL = { HIGH: "High", MODERATE: "Moderate", "LOW-MODERATE": "Low to moderate", LOW: "Low" };

/** FloodLens's 0-100 score for a lookup, or null when it didn't score the spot (it needs data for
 *  70% of its model's weight and never fills the rest with a guess). */
export function floodScore(d) {
  const r = d?.risk_score;
  if (!r || r.overall_score == null) return null;
  const prelim = d.flood_zone?.zone_status === "preliminary";
  return {
    score: Math.round(r.overall_score),
    label: RISK_LABEL[r.risk_label] || null,
    coverage: r.score_basis === "partial" ? r.data_coverage : null,
    prelimDate: prelim ? d.flood_zone.prelim_issue_date || null : null,
  };
}

const ft = (n) => `${Math.abs(n).toFixed(1)} ft`;

/** Ground elevation in plain words: above or below sea level (NAVD88). */
export function elevationText(feet) {
  if (feet == null || !Number.isFinite(feet)) return null;
  if (Math.abs(feet) < 0.05) return "At sea level";
  return feet > 0 ? `${ft(feet)} above sea level` : `${ft(feet)} below sea level`;
}

/** Past flood insurance claims in the census tract, in one line, or null when there's no record. */
export function claimsText(h) {
  if (!h) return null;
  if (h.status === "no_claims_on_record") return "No flood insurance claims on record for this census tract.";
  if (h.status !== "ok") return null;
  const n = h.claims_since_window_start;
  const since = `${n.toLocaleString()} claim${n === 1 ? "" : "s"} in this census tract since ${h.window_start}.`;
  const top = h.top_events?.[0];
  const biggest = top ? ` Most from one event on record: ${top.label} (${top.claims.toLocaleString()}).` : "";
  return since + biggest;
}
