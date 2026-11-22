import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "../src/index.js";
import { FLOODLENS_HEALTH, pingFloodLens } from "../src/keepawake.js";

test("the ping calls FloodLens's health check and reports its status", async () => {
  const calls = [];
  const status = await pingFloodLens(async (url, init) => {
    calls.push([url, init.headers["User-Agent"]]);
    return { status: 200 };
  });
  assert.equal(status, 200);
  assert.deepEqual(calls, [[FLOODLENS_HEALTH, "nolaatlas-keep-awake"]]);
  assert.equal(FLOODLENS_HEALTH, "https://nola-floodlens.onrender.com/api/health");
});

test("a failed ping never throws", async () => {
  assert.equal(await pingFloodLens(async () => Promise.reject(new Error("timed out"))), null);
});

test("the cron trigger hands the ping to waitUntil", async () => {
  const waited = [];
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 200 });
  try {
    worker.scheduled({}, {}, { waitUntil: (p) => waited.push(p) });
    assert.equal(waited.length, 1);
    assert.equal(await waited[0], 200);
  } finally {
    globalThis.fetch = real;
  }
});

test("wrangler.toml schedules the ping every 10 minutes, 7 am to midnight Central (UTC 13-05)", async () => {
  const { readFile } = await import("node:fs/promises");
  const toml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /\[triggers\]\s*\ncrons = \["\*\/10 0-5,13-23 \* \* \*"\]/);
});
