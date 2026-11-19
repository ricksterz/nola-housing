// Schools near an address, from School Finder's school list (etl/export_schools.py writes
// data/schools.json at deploy). Distances are straight-line miles: a ranking of what's close,
// not a commute. Chances of getting in, seats and dates live on School Finder, linked per school.
import { SCHOOLS_URL } from "./links";

export const SCHOOL_RADIUS_MI = 2;
export const SCHOOLS_PER_GROUP = 4;

const EARTH_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function milesBetween(lat1, lng1, lat2, lng2) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 2 * EARTH_MI * Math.asin(Math.sqrt(a));
}

/** { public, private } nearest first, each within SCHOOL_RADIUS_MI and at most SCHOOLS_PER_GROUP. */
export function nearbySchools(schools, lat, lng, { radius = SCHOOL_RADIUS_MI, perGroup = SCHOOLS_PER_GROUP } = {}) {
  const near = (schools || [])
    .map((s) => ({ ...s, miles: milesBetween(lat, lng, s.lat, s.lng) }))
    .filter((s) => s.miles <= radius)
    .sort((a, b) => a.miles - b.miles);
  return {
    public: near.filter((s) => s.kind === "public").slice(0, perGroup),
    private: near.filter((s) => s.kind !== "public").slice(0, perGroup),
  };
}

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
