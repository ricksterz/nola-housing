import assert from "node:assert/strict";
import { test } from "node:test";
import { annualTax, assessorMarket, monthlyCost, yearlyCost } from "../src/lib/costs.js";

const COSTS = {
  zips: {
    70005: {
      tax: { full_rate: 0.0072, effective_rate: 0.0061, acs_year: 2023 },
      flood: { sfha: { median: 1800, policies: 40 }, other: { median: 650, policies: 300 } },
    },
    70130: { tax: { effective_rate: 0.005 } }, // older data: no full_rate
  },
};
const HOME = { zip_code: "70005", assessed_val: 28110, exempt_val: 7500, flood_zone: "X", flood_sfha: false };

test("yearly cost: tax on assessed minus exemptions at the ZIP's rate per assessed dollar, plus flood", () => {
  const c = yearlyCost(HOME, COSTS);
  assert.equal(c.taxable, 20610);
  assert.ok(Math.abs(c.mills - 72) < 1e-9); // full_rate 0.72% of market value = 72 mills on 10%
  assert.equal(c.tax, Math.round(20610 * 0.072));
  assert.equal(c.flood.median, 650);
  assert.equal(c.flood.group, "other");
  assert.equal(c.total, c.tax + 650);
  assert.equal(c.acsYear, 2023);
});

test("a parcel in an A or V zone gets the high-risk premium", () => {
  const c = yearlyCost({ ...HOME, flood_zone: "AE", flood_sfha: true }, COSTS);
  assert.equal(c.flood.group, "sfha");
  assert.equal(c.flood.median, 1800);
});

test("exemptions: exempt_val first, then the homestead column, never below zero", () => {
  assert.equal(yearlyCost({ ...HOME, exempt_val: undefined, homestead_exempt_val: 7500 }, COSTS).taxable, 20610);
  assert.equal(yearlyCost({ ...HOME, exempt_val: null }, COSTS).taxable, 28110);
  assert.equal(yearlyCost({ ...HOME, assessed_val: 5000 }, COSTS).tax, 0);
});

test("no yearly cost without a tax rate or an assessed value; no flood part without a zone", () => {
  assert.equal(yearlyCost({ ...HOME, zip_code: "70130" }, COSTS), null);
  assert.equal(yearlyCost({ ...HOME, zip_code: "70999" }, COSTS), null);
  assert.equal(yearlyCost({ ...HOME, assessed_val: 0 }, COSTS), null);
  assert.equal(yearlyCost({ ...HOME, assessed_val: null }, COSTS), null); // Orleans today
  assert.equal(yearlyCost(HOME, null), null);
  const noZone = yearlyCost({ ...HOME, flood_zone: null }, COSTS);
  assert.equal(noZone.flood, null);
  assert.equal(noZone.total, noZone.tax);
});

test("assessor market value: Jefferson homes only, assessed × 10", () => {
  const jeff = { parish: "jefferson", assessed_val: 28110, zoning: "R-1A" };
  assert.equal(assessorMarket(jeff), 281100);
  assert.equal(assessorMarket({ ...jeff, zoning: "C-2" }), null); // commercial: assessed at 15%
  assert.equal(assessorMarket({ ...jeff, zoning: null, homestead_exempt_val: 7500 }), 281100);
  assert.equal(assessorMarket({ ...jeff, zoning: null, exempt_val: 7500 }), 281100);
  assert.equal(assessorMarket({ ...jeff, zoning: null, exempt_val: 50000 }), null); // more than a homestead
  assert.equal(assessorMarket({ ...jeff, zoning: null }), null);
  assert.equal(assessorMarket({ ...jeff, tot_mkt_val: 300000 }), null); // the roll's own figure wins
  assert.equal(assessorMarket({ ...jeff, assessed_val: 0 }), null);
  assert.equal(assessorMarket({ parish: "orleans", assessed_val: 28110, zoning: "R-1A" }), null);
});

test("ZIP Scorecard tax: price minus the homestead exemption, or the full price for a rental", () => {
  const tax = COSTS.zips[70005].tax;
  assert.equal(annualTax(tax, 300000), 0.0072 * 225000);
  assert.equal(annualTax(tax, 300000, { homestead: false }), 0.0072 * 300000);
  assert.equal(annualTax(tax, 50000), 0);
  assert.equal(annualTax(COSTS.zips[70130].tax, 300000), 300000 * 0.005); // effective rate fallback
  assert.equal(annualTax(null, 300000), 0);
});

test("monthly cost adds the loan payment and a twelfth of each yearly bill", () => {
  const m = monthlyCost({ price: 300000, downPct: 20, ratePct: 6.5, taxAnnual: 1200, homeownersAnnual: 3600, floodAnnual: 600 });
  assert.ok(Math.abs(m.pi - 1516.96) < 0.01);
  assert.equal(m.tax, 100);
  assert.equal(m.home, 300);
  assert.equal(m.flood, 50);
  assert.ok(Math.abs(m.total - (m.pi + 450)) < 1e-9);
  assert.equal(monthlyCost({ price: 0 }), null);
});
