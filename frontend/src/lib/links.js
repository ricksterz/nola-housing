// The sister sites the hub links to. Each opens in a new tab and gets only what it needs: School
// Finder a ZIP, FloodLens the address (never an owner or anything else from the page).

// NOLA Atlas School Finder (school seats, chances and tuition for Jefferson and Orleans).
export const SCHOOLS_URL = "https://schools.nolaatlas.com/";

// FloodLens (flood score plus Drainage, Levee and Surge lenses for any Louisiana address).
export const FLOODLENS_URL = "https://nola-floodlens.onrender.com/";

/** FloodLens opened on an address, optionally on one lens (home, drains, levees, surge). */
export function floodLensLink(address, lens) {
  const q = new URLSearchParams({ address });
  if (lens) q.set("lens", lens);
  return `${FLOODLENS_URL}?${q}`;
}
