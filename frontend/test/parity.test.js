// The site's copies of rules the Python ETL also implements, checked against the cases in
// tests/fixtures/js_parity.json (tests/test_js_parity.py checks the Python side). If one side
// changes and the other doesn't, the site asks for data files that were never written.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bundleKey } from "../src/lib/bundles.js";
import { titleCase } from "../src/lib/names.js";
import { nearKey } from "../src/lib/nearby.js";

const CASES = JSON.parse(readFileSync(new URL("../../tests/fixtures/js_parity.json", import.meta.url), "utf8"));

test("bundleKey matches etl/export_static.py bundle_key", () => {
  for (const [key, n, expected] of CASES.bundle_key) assert.equal(bundleKey(key, n), expected, key);
});

test("nearKey matches etl/export_static.py near_key", () => {
  for (const [lat, lng, expected] of CASES.near_key) assert.equal(nearKey(lat, lng), expected, `${lat},${lng}`);
});

test("titleCase reads owner keys the way etl/export_owners.py display_name does", () => {
  for (const [raw, expected] of CASES.display_name) assert.equal(titleCase(raw), expected, raw);
});
