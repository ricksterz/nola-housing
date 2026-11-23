// The site's Terms and Privacy text (data/legal.json): placeholders fill the same way as
// etl/prerender.py legal_fill (tests/test_prerender.py checks the same sentences there).
import assert from "node:assert/strict";
import { test } from "node:test";
import { legal, legalFill } from "../src/lib/legal.js";

const unregistered = { ...legal, operator: null, operator_full: null, contact: null };
const registered = { ...legal, ...legal.when_registered };
const all = JSON.stringify([legal.terms, legal.privacy]);

test("until the LLC is registered, the pages name the site, not a company", () => {
  const text = legalFill(`${legal.terms.intro} {owner} {parties} {same_operator}`, unregistered);
  assert.match(text, /independent project based in Louisiana/);
  assert.doesNotMatch(text, /LLC/);
});

test("once registered, one change names the company everywhere", () => {
  const text = legalFill(`${legal.terms.intro} {parties}`, registered);
  assert.match(text, /is operated by JCE Labs LLC, a Louisiana limited liability company/);
  assert.match(text, /JCE Labs LLC and its members, managers and contributors/);
});

test("every placeholder in the text is one the fill knows", () => {
  for (const l of [unregistered, registered]) assert.doesNotMatch(legalFill(all, l), /\{[a-z_]+\}/);
});

test("the terms keep the clauses this site relies on", () => {
  const t = JSON.stringify(legal.terms).toLowerCase();
  for (const clause of [
    "not a consumer reporting agency",
    "not an official flood zone determination",
    "to the fullest extent permitted by law",
    "louisiana civil code article 2004",
    "fair housing act",
  ]) assert.ok(t.includes(clause), clause);
});
