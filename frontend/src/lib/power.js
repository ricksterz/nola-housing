import power from "../data/power.json";

/** The electric utility and its regulator for a parish ("orleans" | "jefferson"), from power.json. */
export function utilityFor(parish) {
  if (parish !== "orleans" && parish !== "jefferson") return null;
  return power.utilities[parish === "orleans" ? 0 : 1];
}

/** Whole days from today to an ISO date (negative once it has passed). */
export function daysUntil(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((new Date(y, m - 1, d) - today) / 86400000);
}
