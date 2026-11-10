// FEMA zone → plain language. SFHA ("special flood hazard area") zones are A* and V*; lenders
// must require flood insurance there on federally backed mortgages.
export function floodInfo(p) {
  const zone = (p.flood_zone || "").toUpperCase();
  if (!zone) return null;
  const sub = (p.flood_zone_subtype || "").toUpperCase();
  const required = "Lenders require flood insurance here on federally backed mortgages.";
  if (zone.startsWith("V")) {
    return { tone: "high", title: "High-risk coastal flood area", detail: `1% or greater chance of flooding each year, with storm-wave hazard. ${required}` };
  }
  if (zone.startsWith("A")) {
    return { tone: "high", title: "High-risk flood area", detail: `1% or greater chance of flooding each year (the "100-year" floodplain). ${required}` };
  }
  const outside = "Flood insurance isn't federally required here, but FEMA reports more than 20% of flood insurance claims come from outside high-risk areas.";
  if (zone === "X" && sub.includes("LEVEE")) {
    return { tone: "moderate", title: "Reduced risk because of levees", detail: `FEMA credits a levee system with lowering the risk here. Levees can be overtopped or fail. ${outside}` };
  }
  if (zone === "X" && sub.includes("0.2")) {
    return { tone: "moderate", title: "Moderate flood risk", detail: `Between a 1% and 0.2% chance of flooding each year. ${outside}` };
  }
  if (zone === "X") {
    return { tone: "low", title: "Minimal flood hazard on FEMA's map", detail: outside };
  }
  if (zone === "D") {
    return { tone: "low", title: "Flood risk undetermined", detail: "FEMA hasn't analyzed flood hazards for this area." };
  }
  return { tone: "low", title: `FEMA zone ${zone}`, detail: "" };
}
