import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_ITEMS, addItem, changesSince, decodeList, encodeList, hasItem, mergeLists, mergeState, parseList, removeItem, sameState, snapshotOf, withSnapshot } from "../src/lib/watchlist.js";

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

const PARCEL = { owner_name: "SMITH,JOHN", assessed_val: 28110, exempt_val: 7500, tot_mkt_val: null, last_sale_date: "2019-05-01", last_sale_price: 250000, flood_zone: "x" };

test("saving keeps the numbers worth watching, dated", () => {
  const [it] = addItem([], { type: "property", id: "420 Bonnabel Blvd", snap: snapshotOf("property", PARCEL) }, NOW);
  assert.deepEqual(it.snap, { owner: "SMITH,JOHN", assessed: 28110, exempt: 7500, market: null, sale: "2019-05-01|250000", zone: "X", at: NOW.toISOString() });
  assert.equal(snapshotOf("property", null), null);
  assert.deepEqual(snapshotOf("owner", { count: 12 }), { count: 12 });
});

test("a property: new owner, new sale, new assessment and a new flood zone are each reported", () => {
  const snap = snapshotOf("property", PARCEL);
  assert.deepEqual(changesSince("property", snap, PARCEL), []);
  const now = { ...PARCEL, owner_name: "DOE,JANE", last_sale_date: "2026-10-02", last_sale_price: 410000, assessed_val: 30000, flood_zone: "AE" };
  const ch = changesSince("property", snap, now);
  assert.deepEqual(ch.map((c) => c.key), ["owner", "sale", "assessed", "zone"]);
  assert.deepEqual(ch[0], { key: "owner", from: "SMITH,JOHN", to: "DOE,JANE" });
  assert.equal(ch[1].to, "2026-10-02|410000");
  assert.ok(Math.abs(ch[2].pct - 6.72) < 0.01);
  assert.deepEqual(ch[3], { key: "zone", from: "X", to: "AE" });
});

test("a first sale on record counts; a field an old snapshot never had doesn't", () => {
  const snap = snapshotOf("property", { ...PARCEL, last_sale_date: null, last_sale_price: null });
  assert.equal(snap.sale, null);
  assert.deepEqual(changesSince("property", snap, PARCEL).map((c) => c.key), ["sale"]);
  const { zone, ...older } = snap; // eslint-disable-line no-unused-vars
  assert.deepEqual(changesSince("property", older, { ...PARCEL, flood_zone: "AE" }).map((c) => c.key), ["sale"]);
});

test("a ZIP: a real move in value is reported with its month; Zillow's small restatements aren't", () => {
  const row = { zhvi: 411000, zhvi_month: "2026-09-01", median_sale_price: 411000, price_month: "2026-03-01" };
  const snap = snapshotOf("zip", row);
  assert.deepEqual(changesSince("zip", snap, { ...row, zhvi: 412000, zhvi_month: "2026-10-01" }), []); // +0.24%
  const [c] = changesSince("zip", snap, { ...row, zhvi: 420000, zhvi_month: "2026-11-01" });
  assert.equal(c.key, "zhvi");
  assert.equal(c.month, "2026-11-01");
  assert.ok(Math.abs(c.pct - 2.19) < 0.01);
});

test("an owner's count, and marking an item seen moves its starting point", () => {
  let list = addItem([], { type: "owner", id: "acme-llc", snap: { count: 12 } }, NOW);
  assert.deepEqual(changesSince("owner", list[0].snap, { count: 14 }), [{ key: "count", from: 12, to: 14, pct: (2 / 12) * 100 }]);
  const later = new Date("2026-12-01T00:00:00Z");
  list = withSnapshot(list, "owner", "acme-llc", { count: 14 }, later);
  assert.deepEqual(list[0].snap, { count: 14, at: later.toISOString() });
  assert.deepEqual(changesSince("owner", list[0].snap, { count: 14 }), []);
  assert.deepEqual(changesSince("owner", undefined, { count: 14 }), []); // not tracked yet
});

test("a list survives the trip through a link, labels and all, but not its snapshots", () => {
  let list = addItem([], { type: "zip", id: "70005", label: "70005 · Old Metairie", snap: { zhvi: 1 } }, NOW);
  list = addItem(list, { type: "property", id: "1234 St. Charles Ave #3, New Orleans", label: "1234 St. Charles Ave #3, New Orleans" }, NOW);
  list = addItem(list, { type: "owner", id: "café-du-monde-llc", label: "Café du Monde LLC" }, NOW);
  const code = encodeList(list);
  assert.match(code, /^[A-Za-z0-9_-]+$/); // safe in a URL as it is
  const back = decodeList(code);
  assert.deepEqual(back.map((it) => [it.type, it.id, it.label]), list.map((it) => [it.type, it.id, it.label]));
  assert.ok(back.every((it) => !it.snap));
});

test("a damaged link reads as nothing", () => {
  assert.equal(decodeList("not-a-list"), null);
  assert.equal(decodeList(""), null);
  assert.equal(decodeList(encodeList([]).slice(0, 5)), null);
  assert.deepEqual(decodeList(encodeList([])), []);
});

test("adding a shared list keeps yours first, skips repeats and stops at the limit", () => {
  const mine = addItem([], { type: "zip", id: "70005" }, NOW);
  const theirs = [{ type: "zip", id: "70005", label: "x" }, { type: "zip", id: "70130", label: "70130" }];
  assert.deepEqual(mergeLists(mine, theirs, NOW).map((it) => it.id), ["70005", "70130"]);
  assert.deepEqual(mergeLists([], theirs, NOW).map((it) => it.id), ["70005", "70130"]); // replace
  const many = Array.from({ length: MAX_ITEMS }, (_, i) => ({ type: "zip", id: String(71000 + i) }));
  assert.equal(mergeLists(mine, many, NOW).length, MAX_ITEMS);
});

test("merging two copies: the later save wins, removals stick, and order doesn't matter", () => {
  const a = { items: [{ type: "zip", id: "70005", label: "old", savedAt: "2026-11-01T00:00:00Z" }], removed: {} };
  const b = { items: [{ type: "zip", id: "70005", label: "new", savedAt: "2026-11-01T00:00:00Z", snap: { zhvi: 1, at: "2026-11-05T00:00:00Z" } }], removed: { "zip:70130": "2026-11-04T00:00:00Z" } };
  const ab = mergeState(a, b, NOW);
  assert.deepEqual(ab, mergeState(b, a, NOW));
  assert.equal(ab.items[0].label, "new"); // marked seen later
  assert.deepEqual(Object.keys(ab.removed), ["zip:70130"]);
  const removedLater = mergeState(ab, { items: [], removed: { "zip:70005": "2026-11-06T00:00:00Z" } }, NOW);
  assert.deepEqual(removedLater.items, []);
  assert.ok(sameState(mergeState(ab, ab, NOW), ab));
  // Removals older than 180 days are forgotten.
  assert.deepEqual(mergeState({ items: [], removed: { "zip:1": "2026-01-01T00:00:00Z" } }, null, NOW).removed, {});
});
