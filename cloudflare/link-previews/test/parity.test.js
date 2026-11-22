// The Worker's copies of rules the ETL also implements, checked against the cases in
// tests/fixtures/js_parity.json (tests/test_js_parity.py checks the Python side).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bundleKey, slugify } from "../src/meta.js";

const CASES = JSON.parse(readFileSync(new URL("../../../tests/fixtures/js_parity.json", import.meta.url), "utf8"));

test("bundleKey matches etl/export_static.py bundle_key", () => {
  for (const [key, n, expected] of CASES.bundle_key) assert.equal(bundleKey(key, n), expected, key);
});

test("slugify matches backend/queries.py slugify", () => {
  for (const [raw, expected] of CASES.slugify) assert.equal(slugify(raw), expected, raw);
});
