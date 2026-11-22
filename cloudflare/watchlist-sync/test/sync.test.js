import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_DATA, handle, sweep } from "../src/index.js";
import { fakeD1 } from "./d1.js";

const ID = "a".repeat(64);
const AUTH = "b".repeat(64);
const OTHER = "c".repeat(64);

function call(env, method, path, body, headers = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] ??= "application/json";
  }
  return handle(new Request(`https://nolaatlas.com/api/sync/${path}`, init), env);
}

test("health answers so the site can show its Sync panel", async () => {
  const res = await call({ DB: fakeD1() }, "GET", "health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("create, read, update with the version last seen", async () => {
  const env = { DB: fakeD1() };
  assert.equal((await call(env, "GET", ID)).status, 404);
  let res = await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "first" });
  assert.deepEqual(await res.json(), { rev: 1 });
  assert.deepEqual(await (await call(env, "GET", ID)).json(), { rev: 1, data: "first" });
  res = await call(env, "PUT", ID, { rev: 1, auth: AUTH, data: "second" });
  assert.deepEqual(await res.json(), { rev: 2 });
  // The token is stored only as a hash.
  const row = env.DB.raw.prepare("SELECT auth_hash FROM lists").get();
  assert.notEqual(row.auth_hash, AUTH);
  assert.match(row.auth_hash, /^[0-9a-f]{64}$/);
});

test("a stale version gets the current list back to merge with", async () => {
  const env = { DB: fakeD1() };
  await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "one" });
  await call(env, "PUT", ID, { rev: 1, auth: AUTH, data: "two" });
  const res = await call(env, "PUT", ID, { rev: 1, auth: AUTH, data: "stale" });
  assert.equal(res.status, 409);
  assert.deepEqual(await res.json(), { rev: 2, data: "two" });
  const again = await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "newer" }); // already exists
  assert.equal(again.status, 409);
});

test("only the list's own token can change or delete it", async () => {
  const env = { DB: fakeD1() };
  await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "mine" });
  assert.equal((await call(env, "PUT", ID, { rev: 1, auth: OTHER, data: "theirs" })).status, 403);
  assert.equal((await call(env, "PUT", ID, { rev: 0, auth: OTHER, data: "theirs" })).status, 403);
  assert.equal((await call(env, "DELETE", ID, { auth: OTHER })).status, 403);
  assert.deepEqual(await (await call(env, "GET", ID)).json(), { rev: 1, data: "mine" });
  assert.equal((await call(env, "DELETE", ID, { auth: AUTH })).status, 204);
  assert.equal((await call(env, "GET", ID)).status, 404);
  assert.equal((await call(env, "DELETE", ID, { auth: AUTH })).status, 204); // already gone
  assert.equal((await call(env, "PUT", ID, { rev: 3, auth: AUTH, data: "x" })).status, 404);
});

test("malformed requests are refused", async () => {
  const env = { DB: fakeD1() };
  assert.equal((await call(env, "GET", "not-an-id")).status, 404);
  assert.equal((await call(env, "PUT", ID, { rev: -1, auth: AUTH, data: "x" })).status, 400);
  assert.equal((await call(env, "PUT", ID, { rev: 0, auth: "short", data: "x" })).status, 400);
  assert.equal((await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "has spaces" })).status, 400);
  assert.equal((await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "x".repeat(MAX_DATA + 1) })).status, 400);
  assert.equal((await call(env, "PUT", ID, "not json")).status, 400);
  assert.equal((await call(env, "PUT", ID, "{}", { "content-type": "text/plain" })).status, 415);
  assert.equal((await call(env, "POST", ID, { rev: 0 })).status, 405);
});

test("another site's pages are turned away", async () => {
  const env = { DB: fakeD1() };
  const res = await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "x" }, { origin: "https://evil.example" });
  assert.equal(res.status, 403);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  const ok = await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "x" }, { origin: "https://nolaatlas.com" });
  assert.equal(ok.status, 200);
});

test("the daily sweep drops lists untouched for 400 days", async () => {
  const env = { DB: fakeD1() };
  await call(env, "PUT", ID, { rev: 0, auth: AUTH, data: "x" });
  assert.equal(await sweep(env.DB, new Date(Date.now() + 399 * 86400000)), 0);
  assert.equal(await sweep(env.DB, new Date(Date.now() + 401 * 86400000)), 1);
});
