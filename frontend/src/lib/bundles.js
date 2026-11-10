// Per-record pages are bundled: each file holds many records as {key: record}, picked by a hash
// of the key, because GitHub Pages deploys time out on hundreds of thousands of files. Must match
// etl/export_static.py (BUNDLES, bundle_key) and cloudflare/link-previews/src/meta.js.
export const BUNDLES = {
  props: 8192, // property pages (parcels, condo units, buildings) by slug
  owners: 512, // owner pages by owner slug
  ownnames: 2048, // owner-name search by word prefix
};

/** The bundle file name holding `key`: FNV-1a (32-bit) mod n, in hex padded to n - 1's width. */
export function bundleKey(key, n) {
  const bytes = new TextEncoder().encode(key);
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return (h % n).toString(16).padStart((n - 1).toString(16).length, "0");
}
