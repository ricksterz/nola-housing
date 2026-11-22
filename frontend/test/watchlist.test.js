import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ITEMS, addItem, hasItem, parseList, removeItem } from "../src/lib/watchlist.js";

const NOW = new Date("2026-11-22T12:00:00Z");

test("saving adds to the front; saving again moves it there instead of repeating it", () => {
  let list = addItem([], { type: "zip", id: "70005", label: "70005 · Metairie" }, NOW);
  list = addItem(list, { type: "property", id: "420 Bonnabel Blvd", label: "420 Bonnabel Blvd, Metairie" }, NOW);
  assert.deepEqual(list.map((it) => it.id), ["420 Bonnabel Blvd", "70005"]);
  list = addItem(list, { type: "zip", id: "70005" }, NOW);
  assert.deepEqual(list.map((it) => it.id), ["70005", "420 Bonnabel Blvd"]);
  assert.equal(list[0].savedAt, NOW.toISOString());
  assert.equal(list[0].label, "70005"); // no label given: the id stands in
});

test("the same id under two types is two items; remove takes out only the one asked", () => {
  let list = addItem([], { type: "zip", id: "70130" }, NOW);
  list = addItem(list, { type: "property", id: "70130" }, NOW);
  assert.equal(list.length, 2);
  assert.ok(hasItem(list, "zip", "70130") && hasItem(list, "property", "70130"));
  list = removeItem(list, "zip", "70130");
  assert.ok(!hasItem(list, "zip", "70130") && hasItem(list, "property", "70130"));
});

test("unknown types and empty ids are never saved", () => {
  assert.deepEqual(addItem([], { type: "street", id: "bonnabel-blvd" }, NOW), []);
  assert.deepEqual(addItem([], { type: "zip", id: "" }, NOW), []);
});

test("the list never grows past its limit", () => {
  let list = [];
  for (let i = 0; i < MAX_ITEMS + 5; i++) list = addItem(list, { type: "zip", id: String(70000 + i) }, NOW);
  assert.equal(list.length, MAX_ITEMS);
});

test("a stored list reads back clean: junk, unknown types and repeats are dropped", () => {
  const stored = JSON.stringify({
    v: 1,
    items: [
      { type: "zip", id: "70005", label: "70005 · Metairie", savedAt: "2026-11-01T00:00:00Z" },
      { type: "zip", id: "70005", label: "again" },
      { type: "neighborhood", id: "lakeview" },
      { type: "owner", id: "" },
      { type: "owner", id: 42 },
      null,
      { type: "owner", id: "new-orleans-city-of" },
    ],
  });
  const list = parseList(stored);
  assert.deepEqual(list, [
    { type: "zip", id: "70005", label: "70005 · Metairie", savedAt: "2026-11-01T00:00:00Z" },
    { type: "owner", id: "new-orleans-city-of", label: "new-orleans-city-of", savedAt: null },
  ]);
  assert.deepEqual(parseList("not json"), []);
  assert.deepEqual(parseList(null), []);
  assert.deepEqual(parseList('{"items": "nope"}'), []);
});
