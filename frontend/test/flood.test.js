import assert from "node:assert/strict";
import { test } from "node:test";
import { floodInfo } from "../src/lib/flood.js";
import { claimsText, elevationText, floodScore } from "../src/lib/floodlens.js";

test("FEMA zones in plain language", () => {
  assert.equal(floodInfo({ flood_zone: "AE" }).title, "High-risk flood area");
  assert.equal(floodInfo({ flood_zone: "ve" }).title, "High-risk coastal flood area");
  assert.equal(floodInfo({ flood_zone: "X", flood_zone_subtype: "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE" }).title, "Reduced risk because of levees");
  assert.equal(floodInfo({ flood_zone: "X", flood_zone_subtype: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }).tone, "moderate");
  assert.equal(floodInfo({ flood_zone: "X" }).tone, "low");
  assert.equal(floodInfo({ flood_zone: "D" }).title, "Flood risk undetermined");
  assert.equal(floodInfo({ flood_zone: "" }), null);
  assert.match(floodInfo({ flood_zone: "A" }).detail, /Lenders require flood insurance/);
});

test("FloodLens score: rounded, labeled, with partial coverage and preliminary maps noted", () => {
  const s = floodScore({ risk_score: { overall_score: 61.4, risk_label: "MODERATE", score_basis: "full", data_coverage: 1 }, flood_zone: { zone_status: "effective" } });
  assert.deepEqual(s, { score: 61, label: "Moderate", coverage: null, prelimDate: null });
  const p = floodScore({
    risk_score: { overall_score: 80, risk_label: "LOW-MODERATE", score_basis: "partial", data_coverage: 0.74 },
    flood_zone: { zone_status: "preliminary", prelim_issue_date: "2025-06-30" },
  });
  assert.equal(p.label, "Low to moderate");
  assert.equal(p.coverage, 0.74);
  assert.equal(p.prelimDate, "2025-06-30");
});

test("no FloodLens score when it didn't score the spot", () => {
  assert.equal(floodScore({ risk_score: { overall_score: null } }), null);
  assert.equal(floodScore({}), null);
  assert.equal(floodScore(null), null);
});

test("ground elevation above or below sea level", () => {
  assert.equal(elevationText(-2.14), "2.1 ft below sea level");
  assert.equal(elevationText(3), "3.0 ft above sea level");
  assert.equal(elevationText(0.04), "At sea level");
  assert.equal(elevationText(null), null);
  assert.equal(elevationText(NaN), null);
});

test("past flood claims in one line", () => {
  assert.equal(claimsText({ status: "no_claims_on_record" }), "No flood insurance claims on record for this census tract.");
  assert.equal(claimsText({ status: "ok", claims_since_window_start: 1, window_start: 1978, top_events: [] }), "1 claim in this census tract since 1978.");
  assert.equal(
    claimsText({ status: "ok", claims_since_window_start: 1204, window_start: 1978, top_events: [{ label: "Hurricane Katrina", claims: 812 }] }),
    "1,204 claims in this census tract since 1978. Most from one event on record: Hurricane Katrina (812).",
  );
  assert.equal(claimsText({ status: "error" }), null);
  assert.equal(claimsText(null), null);
});
