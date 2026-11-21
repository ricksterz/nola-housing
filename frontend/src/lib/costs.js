import { useEffect, useState } from "react";
import { monthlyPayment } from "./theme";

// Homeowners (wind/fire) insurance has no public ZIP-level data, so it's always the reader's
// number. The starting value is a placeholder inside the range 2026 insurance-comparison sites
// publish for Louisiana (~$2,900–$7,300/yr, depending on the source and coverage) — not a quote.
export const HOMEOWNERS_DEFAULT = 3700;
export const HOMEOWNERS_RANGE = "about $2,900–$7,300 a year";

export const COST_PARTS = [
  { key: "pi", label: "Principal & interest", slot: 0 },
  { key: "tax", label: "Property tax", slot: 2 },
  { key: "home", label: "Homeowners insurance", slot: 3 },
  { key: "flood", label: "Flood insurance", slot: 1 },
];

// Louisiana homestead exemption, $75,000 of market value; the data file carries the same figure.
const HOMESTEAD_EXEMPT_DEFAULT = 75000;

/**
 * Annual property tax for a ZIP's rates. A home you live in is taxed on its price minus the
 * homestead exemption; a rental or second home on the full price. ``full_rate`` is the ZIP's
 * rate with the exemption backed out (etl/load_costs.py); data from before it existed falls
 * back to the effective rate on the full price, which already reflects the exemption.
 */
export function annualTax(tax, price, { homestead = true, exempt = HOMESTEAD_EXEMPT_DEFAULT } = {}) {
  if (!tax || !price) return 0;
  if (tax.full_rate == null) return price * tax.effective_rate;
  return tax.full_rate * (homestead ? Math.max(price - exempt, 0) : price);
}

/** Monthly cost of owning: loan payment + tax + insurance. Annual inputs; monthly outputs. */
export function monthlyCost({ price, downPct, ratePct, taxAnnual, homeownersAnnual, floodAnnual }) {
  if (!price) return null;
  const parts = {
    pi: monthlyPayment(price * (1 - downPct / 100), ratePct) || 0,
    tax: (taxAnnual || 0) / 12,
    home: (homeownersAnnual || 0) / 12,
    flood: (floodAnnual || 0) / 12,
  };
  return { ...parts, total: parts.pi + parts.tax + parts.home + parts.flood };
}

const KEY = "nola-cost-assumptions";

// FRED ships the mortgage rate with full float precision (7.28000020980835); round it to the
// two decimals a rate is quoted in before it reaches a number input or a sentence. Older
// versions saved the raw float to localStorage, so a saved value is rounded on the way in too.
const roundRate = (v) => (v == null || v === "" ? v : Math.round(Number(v) * 100) / 100);

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    const rate = roundRate(saved.rate);
    if (Number.isFinite(rate)) saved.rate = rate;
    else delete saved.rate;
    return saved;
  } catch {
    return {};
  }
}

/** Rate, down payment, homeowners premium, flood and homestead toggles, shared between views and kept
 * per-browser so the reader doesn't retype them. Rate follows FRED until the reader edits it. */
export function useCostAssumptions(defaultRate) {
  const [a, setA] = useState(() => ({
    rate: null,
    down: 20,
    homeowners: HOMEOWNERS_DEFAULT,
    includeFlood: true,
    homestead: true,
    ...readSaved(),
  }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(a));
    } catch {
      /* private mode */
    }
  }, [a]);
  // A rate patch is rounded the same way, so a typed or pasted value can never carry float dust.
  const set = (patch) =>
    setA((prev) => ({ ...prev, ...patch, ...(patch.rate != null ? { rate: roundRate(patch.rate) } : {}) }));
  return { ...a, rate: a.rate ?? roundRate(defaultRate) ?? 6.5, set };
}

// Louisiana assesses a home at 10% of its market value; millage applies per assessed dollar.
const HOME_ASSESSMENT_RATIO = 0.1;

/**
 * A parcel's yearly property tax and flood insurance, from its own roll values and its ZIP's rates.
 * Tax: assessed value minus the exemptions on the roll, times the ZIP's tax rate per assessed
 * dollar. The ZIP's rate (etl/load_costs.py full_rate) is tax per dollar of a home's market value,
 * and a home is assessed at 10% of that, so the rate per assessed dollar is full_rate ÷ 10%; millage
 * is the same for every kind of property. Flood: the ZIP's median NFIP premium for policies in the
 * parcel's zone class (high-risk A/V or not). Each part is null where its data doesn't exist; the
 * whole is null without the tax part, since a "yearly cost" of flood insurance alone misleads.
 */
export function yearlyCost(p, costs) {
  const z = costs?.zips?.[p?.zip_code];
  const rate = z?.tax?.full_rate;
  if (!rate || !(p?.assessed_val > 0)) return null;
  const exempt = p.exempt_val ?? p.homestead_exempt_val ?? 0;
  const taxable = Math.max(p.assessed_val - exempt, 0);
  const perAssessed = rate / HOME_ASSESSMENT_RATIO;
  const group = p.flood_sfha === true ? "sfha" : p.flood_zone ? "other" : null;
  const flood = group ? z.flood?.[group] ?? null : null;
  const tax = Math.round(taxable * perAssessed);
  return {
    taxable,
    mills: perAssessed * 1000,
    acsYear: z.tax.acs_year,
    tax,
    flood: flood?.median ? { ...flood, group } : null,
    total: tax + (flood?.median || 0),
  };
}
