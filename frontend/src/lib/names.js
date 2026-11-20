// The assessor rolls are all capitals ("SCHLANKER,WILLIAM A & AUBREY A", "HIGHWAY PK SQ 1 THRU 203").
// These read them out in title case. Same word rules as etl/export_owners.py display_name.

// Company forms, agencies and generational suffixes, kept in capitals.
const CAPS = new Set([
  "LLC", "LLP", "LP", "II", "III", "IV", "VI", "USA", "US", "HUD", "NOLA", "LSU", "DOTD", "NA", "PLLC",
  "CCC", "DBA", "MD", "CPA", "PC", "RV", "TV",
]);
// Abbreviations with no vowel that are still ordinary words: "St", "Sq", "Pk", "Jr".
const TITLE_ABBR = new Set([
  "ST", "STS", "SQ", "SQS", "PK", "DR", "MR", "MRS", "MS", "JR", "SR", "BLVD", "HWY", "HGTS", "HTS", "PL",
  "CT", "LN", "RD", "PKWY", "TWP", "CTR", "BLDG", "PT", "MT", "FT", "BR", "BRS", "PTS",
]);
// Joining words in lower case, except as a name's first word.
const SMALL = new Set(["OF", "THE", "AND", "FOR", "AT", "IN", "ON", "TO", "THRU"]);
// "& WF" on the roll is "and wife".
const SPELLED = { ETAL: "et al", ETUX: "et ux", ETVIR: "et vir", WF: "wife", HUS: "husband" };

function word(w, first) {
  const up = w.toUpperCase();
  if (SPELLED[up]) return SPELLED[up];
  if (CAPS.has(up) || up.length === 1) return up;
  if (TITLE_ABBR.has(up)) return up[0] + up.slice(1).toLowerCase();
  if (SMALL.has(up) && !first) return up.toLowerCase();
  // Initials run together ("KH & JW METRO LAND", "RXMD LLC"): no vowel, so not a word.
  if (up.length <= 4 && !/[AEIOUY]/.test(up)) return up;
  // O'Brien, D'Antoni; but Mary's.
  const apos = up.match(/^([A-Z])'([A-Z]{2,})$/);
  if (apos) return `${apos[1]}'${apos[2][0]}${apos[2].slice(1).toLowerCase()}`;
  // McDonald, McCorkle.
  const mc = up.match(/^MC([A-Z]{2,})$/);
  if (mc) return `Mc${mc[1][0]}${mc[1].slice(1).toLowerCase()}`;
  return up[0] + up.slice(1).toLowerCase();
}

/** "NEW ORLEANS,CITY OF" -> "New Orleans, City of"; "MCDONALD,MARY A & WF" -> "McDonald, Mary A & wife". */
export function titleCase(raw) {
  let first = true;
  return String(raw || "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[A-Za-z]+(?:'[A-Za-z]+)?|[,&]/g, (w) => {
      if (w === "," || w === "&") {
        first = w === ",";
        return w;
      }
      const out = word(w, first);
      first = false;
      return out;
    });
}

/** Jefferson's subdivision names, some with the roll's internal code on the end ("LAKE TRAIL_4544"). */
export function subdivisionName(raw) {
  return titleCase(String(raw || "").replace(/_\d+$/, ""));
}
