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

/** Monthly cost of owning: loan payment + tax + insurance. Annual inputs; monthly outputs. */
export function monthlyCost({ price, downPct, ratePct, taxRate, homeownersAnnual, floodAnnual }) {
  if (!price) return null;
  const parts = {
    pi: monthlyPayment(price * (1 - downPct / 100), ratePct) || 0,
    tax: taxRate != null ? (price * taxRate) / 12 : 0,
    home: (homeownersAnnual || 0) / 12,
    flood: (floodAnnual || 0) / 12,
  };
  return { ...parts, total: parts.pi + parts.tax + parts.home + parts.flood };
}

/** Flood cost group for a parcel: its own zone class when known, else the ZIP overall. */
export function floodGroup(parcel) {
  if (parcel?.flood_sfha === true) return "sfha";
  if (parcel?.flood_zone) return "other";
  return "all";
}

const KEY = "nola-cost-assumptions";

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

/** Rate, down payment, homeowners premium and flood toggle, shared between views and kept
 * per-browser so the reader doesn't retype them. Rate follows FRED until the reader edits it. */
export function useCostAssumptions(defaultRate) {
  const [a, setA] = useState(() => ({
    rate: null,
    down: 20,
    homeowners: HOMEOWNERS_DEFAULT,
    includeFlood: true,
    ...readSaved(),
  }));
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(a));
    } catch {
      /* private mode */
    }
  }, [a]);
  const set = (patch) => setA((prev) => ({ ...prev, ...patch }));
  return { ...a, rate: a.rate ?? defaultRate ?? 6.5, set };
}
