// Schools near an address, from School Finder's school list (etl/export_schools.py writes
// data/schools.json at deploy). Distances are straight-line miles: a ranking of what's close,
// not a commute. Chances of getting in, seats and dates live on School Finder, linked per school.
import { SCHOOLS_URL } from "./links.js";

export const SCHOOL_RADIUS_MI = 2;
export const SCHOOLS_SHOWN = 8;
// The filter chips, in order. "private" is private schools that aren't Catholic.
export const SCHOOL_KINDS = [
  ["all", "All"],
  ["public", "Public"],
  ["private", "Private"],
  ["catholic", "Catholic"],
];

const EARTH_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function milesBetween(lat1, lng1, lat2, lng2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(a));
}

/** Every located school with its straight-line distance from the address, nearest first. */
export function schoolsByDistance(schools, lat, lng) {
  return (schools || []).map((s) => ({ ...s, miles: milesBetween(lat, lng, s.lat, s.lng) })).sort((a, b) => a.miles - b.miles);
}

export const matchesKind = (s, kind) => kind === "all" || s.kind === kind;

// How a school takes new students, in the reader's words. School Finder's own codes.
const ADMISSION = {
  zoned: "Attendance zone",
  ncap: "Citywide application (NCAP)",
  ncap_eligibility: "NCAP, with entry requirements",
  charter_lottery: "Charter lottery",
  selective: "Selective admission",
};

export function admissionLabel(s) {
  if (s.kind !== "public") return null;
  return ADMISSION[s.admission] || null;
}

export function kindLabel(s) {
  if (s.kind === "public") return s.charter ? "Public charter" : "Public";
  return s.kind === "catholic" ? "Catholic" : "Private";
}

/** School Finder opened on one school, with this ZIP as home so its distances and chances apply. */
export function schoolLink(s, zip) {
  const q = new URLSearchParams({ school: s.slug });
  if (zip) q.set("zip", zip);
  return `${SCHOOLS_URL}?${q}`;
}

export function schoolsForZipLink(zip) {
  return zip ? `${SCHOOLS_URL}?${new URLSearchParams({ zip })}` : SCHOOLS_URL;
}
