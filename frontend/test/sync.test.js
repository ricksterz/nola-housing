// Sync from both ends: the browser's code (src/lib/sync.js) against the real Worker
// (cloudflare/watchlist-sync) on an in-memory SQLite stand-in for D1.
import assert from "node:assert/strict";
import { test } from "node:test";
import { handle } from "../../cloudflare/watchlist-sync/src/index.js";
import { fakeD1 } from "../../cloudflare/watchlist-sync/test/d1.js";
import { CODE_LENGTH, formatCode, keysFor, newCode, normalizeCode, seal, syncOnce, unseal } from "../src/lib/sync.js";

const CODE = "0123456789ABCDEFGHJK";
const at = (d) => `2026-11-${String(d).padStart(2, "0")}T12:00:00.000Z`;
const zip = (id, d) => ({ type: "zip", id, label: id, savedAt: at(d) });

function server() {
  const env = { DB: fakeD1() };
  const fetchFn = (url, init) => handle(new Request(`https://nolaatlas.com${url}`, init), env);
  return { env, fetchFn };
}

test("codes: 20 characters, no look-alikes, typed any way", () => {
  const c = newCode();
  assert.equal(c.length, CODE_LENGTH);
  assert.match(c, /^[0-9A-HJKMNP-TV-Z]+$/);
  assert.notEqual(newCode(), c);
  assert.equal(formatCode(CODE), "0123-4567-89AB-CDEF-GHJK");
  assert.equal(normalizeCode(" 0123-4567-89ab cdef-ghjk "), CODE);
  assert.equal(normalizeCode("O123-4567-89AB-CDEF-GHJK"), CODE); // O read as 0
  assert.equal(normalizeCode("I123-4567-89AB-CDEF-GHJK"), "1123456789ABCDEFGHJK"); // I read as 1
  assert.equal(normalizeCode("0123-4567"), null);
  assert.equal(normalizeCode("0123-4567-89AB-CDEF-GHJU"), null); // U isn't in the alphabet
});

test("a code always gives the same id and token, and they reveal nothing of it", async () => {
  const a = await keysFor(CODE);
  const b = await keysFor(CODE);
  assert.equal(a.id, b.id);
  assert.equal(a.auth, b.auth);
  assert.match(a.id, /^[0-9a-f]{64}$/);
  assert.notEqual(a.id, a.auth);
  assert.notEqual((await keysFor("1123456789ABCDEFGHJK")).id, a.id);
});

test("sealed lists open only with their own code and row", async () => {
  const keys = await keysFor(CODE);
  const state = { items: [zip("70005", 1)], removed: { "zip:70130": at(2) } };
  const data = await seal(keys, state);
  assert.match(data, /^[A-Za-z0-9_-]+$/);
  assert.ok(!data.includes("70005"));
  assert.deepEqual(await unseal(keys, data), state);
  await assert.rejects(unseal(await keysFor("1123456789ABCDEFGHJK"), data));
  await assert.rejects(unseal({ ...keys, id: "f".repeat(64) }, data)); // moved to another row
  const flipped = data.slice(0, -2) + (data.at(-2) === "A" ? "B" : "A") + data.at(-1);
  await assert.rejects(unseal(keys, flipped));
});

test("turning sync on stores the list; the server sees no addresses", async () => {
  const { env, fetchFn } = server();
  const local = { items: [{ type: "property", id: "420 Bonnabel Blvd", label: "420 Bonnabel Blvd", savedAt: at(1) }], removed: {} };
  const { rev, state } = await syncOnce({ code: CODE, local, create: true, fetchFn });
  assert.equal(rev, 1);
  assert.deepEqual(state.items.map((it) => it.id), ["420 Bonnabel Blvd"]);
  const row = env.DB.raw.prepare("SELECT * FROM lists").get();
  assert.ok(!JSON.stringify(row).includes("Bonnabel"));
  assert.ok(!JSON.stringify(row).includes(CODE));
});

test("a second device joins: both lists combine, and nothing is written twice", async () => {
  const { env, fetchFn } = server();
  await syncOnce({ code: CODE, local: { items: [zip("70005", 1)], removed: {} }, create: true, fetchFn });
  const phone = await syncOnce({ code: CODE, local: { items: [zip("70130", 2)], removed: {} }, fetchFn });
  assert.deepEqual(phone.state.items.map((it) => it.id), ["70130", "70005"]);
  assert.equal(phone.rev, 2);
  const laptop = await syncOnce({ code: CODE, local: { items: [zip("70005", 1)], removed: {} }, fetchFn });
  assert.deepEqual(laptop.state.items.map((it) => it.id), ["70130", "70005"]);
  const again = await syncOnce({ code: CODE, local: laptop.state, fetchFn });
  assert.equal(again.rev, 2); // already in step: no write
  assert.equal(env.DB.raw.prepare("SELECT rev FROM lists").get().rev, 2);
});

test("a removal on one device sticks on the others", async () => {
  const { fetchFn } = server();
  const both = { items: [zip("70005", 1), zip("70130", 2)], removed: {} };
  await syncOnce({ code: CODE, local: both, create: true, fetchFn });
  // The phone removes 70130 on Nov 3; the laptop still has it from Nov 2.
  await syncOnce({ code: CODE, local: { items: [zip("70005", 1)], removed: { "zip:70130": at(3) } }, fetchFn });
  const laptop = await syncOnce({ code: CODE, local: both, fetchFn });
  assert.deepEqual(laptop.state.items.map((it) => it.id), ["70005"]);
  // Saving it again later brings it back everywhere.
  const resaved = await syncOnce({ code: CODE, local: { items: [zip("70130", 4), zip("70005", 1)], removed: {} }, fetchFn });
  assert.deepEqual(resaved.state.items.map((it) => it.id), ["70130", "70005"]);
});

test("a write that loses a race merges with the winner and tries again", async () => {
  const { fetchFn } = server();
  await syncOnce({ code: CODE, local: { items: [zip("70005", 1)], removed: {} }, create: true, fetchFn });
  // Another device writes between this device's read and its write.
  let raced = false;
  const racing = async (url, init) => {
    if (init?.method === "PUT" && !raced) {
      raced = true;
      await syncOnce({ code: CODE, local: { items: [zip("70119", 5)], removed: {} }, fetchFn });
    }
    return fetchFn(url, init);
  };
  const r = await syncOnce({ code: CODE, local: { items: [zip("70130", 3)], removed: {} }, fetchFn: racing });
  assert.deepEqual(r.state.items.map((it) => it.id).sort(), ["70005", "70119", "70130"]);
  assert.equal(r.rev, 3);
});

test("joining with a code nobody made never creates a list", async () => {
  const { env, fetchFn } = server();
  await assert.rejects(syncOnce({ code: CODE, local: { items: [zip("70005", 1)], removed: {} }, fetchFn }), (e) => e.kind === "missing");
  assert.equal(env.DB.raw.prepare("SELECT count(*) AS n FROM lists").get().n, 0);
});

test("no connection: a clear message, nothing lost", async () => {
  const down = async () => {
    throw new TypeError("Failed to fetch");
  };
  await assert.rejects(syncOnce({ code: CODE, local: { items: [], removed: {} }, create: true, fetchFn: down }), (e) => e.kind === "offline");
});
