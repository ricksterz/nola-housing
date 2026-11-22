import assert from "node:assert/strict";
import { test } from "node:test";
import { paramsFromPath, pathFromParams } from "../src/lib/routes.js";

test("paths the deploy pre-builds (etl/prerender.py) read back as views and areas", () => {
  assert.deepEqual(paramsFromPath("/"), {});
  assert.deepEqual(paramsFromPath("/market/"), { view: "overview" });
  assert.deepEqual(paramsFromPath("/market/70130/"), { view: "overview", geo: "zip:70130" });
  assert.deepEqual(paramsFromPath("/market/jefferson/"), { view: "overview", geo: "county:22051" });
  assert.deepEqual(paramsFromPath("/ownership/orleans/"), { view: "ownership", geo: "county:22071" });
  assert.deepEqual(paramsFromPath("/scorecard/"), { view: "scorecard" });
  assert.deepEqual(paramsFromPath("/property"), { view: "property" });
});

test("unknown paths are the hub, never a guess", () => {
  assert.deepEqual(paramsFromPath("/market/st-tammany/"), {});
  assert.deepEqual(paramsFromPath("/scorecard/extra/"), {});
  assert.deepEqual(paramsFromPath("/nope/"), {});
  assert.deepEqual(paramsFromPath(""), {});
});

test("lookups ride as a query on their tab's path", () => {
  assert.equal(pathFromParams({ view: "property", q: "420 Bonnabel Blvd, Metairie" }), "/property/?q=420+Bonnabel+Blvd%2C+Metairie");
  assert.equal(pathFromParams({ view: "ownership", owner: "new-orleans-city-of" }), "/ownership/?owner=new-orleans-city-of");
  assert.equal(pathFromParams({ view: "home" }), "/");
  assert.equal(pathFromParams({}), "/");
  assert.equal(pathFromParams({ view: "property", q: "" }), "/property/");
});

test("areas only on the tabs that show one; the metro is the default area", () => {
  assert.equal(pathFromParams({ view: "overview", geo: "zip:70005" }), "/market/70005/");
  assert.equal(pathFromParams({ view: "overview", geo: "metro:35380" }), "/market/");
  assert.equal(pathFromParams({ view: "ownership", geo: "county:22051" }), "/ownership/jefferson/");
  assert.equal(pathFromParams({ view: "scorecard", geo: "zip:70005" }), "/scorecard/");
  assert.equal(pathFromParams({ view: "overview", geo: "county:99999" }), null);
  assert.equal(pathFromParams({ view: "mystery" }), null);
});

test("every pre-built area path round-trips", () => {
  for (const path of ["/market/", "/market/70005/", "/market/orleans/", "/ownership/", "/ownership/70130/", "/ownership/jefferson/", "/compare/", "/about/"]) {
    assert.equal(pathFromParams(paramsFromPath(path)), path);
  }
});
