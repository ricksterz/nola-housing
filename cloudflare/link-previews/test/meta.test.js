import assert from "node:assert/strict";
import { test } from "node:test";
import { describeOwner, describeProperty, parcelQuery, previewFor, streetOf } from "../src/meta.js";

const META = { geos: [{ geo_level: "zip", geo_id: "70130" }, { geo_level: "zip", geo_id: "70005" }] };
const PARCEL = {
  parcel: {
    parcel_id: "0820008042",
    full_address: "418 Bonnabel Blvd, Metairie, LA 70005",
    zip_code: "70005",
    flood_zone: "AE",
    flood_sfha: true,
    assessed_val: 41230,
    last_sale_price: 512000,
    last_sale_date: "2021-06-04",
    year_built: 1952,
    land_area: 9140,
    owner_name: "DOE JANE",
  },
};
const BUILDING = { building: { full: "1 Poydras St, New Orleans, LA 70130", units: [{}, {}, {}] } };
const DATA = {
  "/data/meta.json": META,
  "/data/property/418-bonnabel-blvd.json": PARCEL,
  "/data/property/1-poydras-st.json": BUILDING,
  "/data/pid/1031096.json": [["103109601", "parcel-103109601", "1 Poydras St, New Orleans, LA 70130"]],
  "/data/property/parcel-103109601.json": {
    parcel: { parcel_id: "103109601", tax_bill_number: "103109601", full_address: "1 Poydras St, New Orleans, LA 70130", zip_code: "70130", flood_zone: "AE", flood_sfha: true },
    building: { address: "1 POYDRAS ST", full: "1 Poydras St, New Orleans, LA 70130" },
  },
  "/data/addr/600.json": [{ address: "600 PORT OF NEW ORLEANS PL", slug: "1-poydras-st", alias: "1 Poydras St, New Orleans, LA 70130" }],
  "/data/owner/housing-authority-of-new-orleans.json": { name: "Housing Authority of New Orleans", count: 1087, parishes: { orleans: 1087 } },
};
const get = async (path) => DATA[path] ?? null;
const preview = (qs, path = "/") => previewFor(new URL(`https://nolaatlas.com${path}?${qs}`), get);

test("parses lookups the way the app does", () => {
  assert.equal(parcelQuery("Parcel 103109601"), "103109601");
  assert.equal(parcelQuery("0820008042a"), "0820008042A");
  assert.equal(parcelQuery("1 Poydras St"), null);
  assert.equal(streetOf("1  Poydras st, New Orleans, LA 70130"), "1 POYDRAS ST");
});

test("a property link previews its address, flood zone and numbers, with its ZIP's image", async () => {
  const p = await preview("view=property&q=418+Bonnabel+Blvd%2C+Metairie%2C+LA+70005");
  assert.equal(p.title, "418 Bonnabel Blvd, Metairie, LA 70005 · NOLA Atlas");
  assert.match(p.description, /^Flood zone AE \(high risk\), assessed at \$41,230, last sold for \$512,000 in 2021, built 1952, lot 9,140 sq ft\. /);
  assert.equal(p.image, "https://nolaatlas.com/og/market-70005.png");
  assert.ok(!p.description.includes("DOE"), "previews don't carry owner names");
});

test("units by tax bill, condo buildings and City address aliases resolve", async () => {
  assert.equal((await preview("view=property&q=Parcel+103109601")).title, "1 Poydras St, New Orleans, LA 70130 (tax bill 103109601) · NOLA Atlas");
  const b = await preview("view=property&q=1+Poydras+St");
  assert.match(b.description, /^3 condo units on record at 1 Poydras St/);
  const alias = await preview("view=property&q=600+Port+of+New+Orleans+Pl");
  assert.equal(alias.title, "1 Poydras St, New Orleans, LA 70130 · NOLA Atlas");
});

test("owner links preview the owner; anything else is left alone", async () => {
  const o = await preview("view=ownership&owner=housing-authority-of-new-orleans");
  assert.equal(o.title, "Housing Authority of New Orleans · 1,087 properties · NOLA Atlas");
  assert.match(o.description, /on the Orleans Parish Assessor's roll under/);
  assert.equal(await preview("view=ownership&owner=../../etc"), null);
  assert.equal(await preview("view=property&q=99999+Nowhere+St"), null);
  assert.equal(await preview("view=scorecard"), null);
  assert.equal(await preview(""), null);
});

test("an unknown ZIP falls back to the generic property image", () => {
  const p = describeProperty({ parcel: { full_address: "1 Main St, Kenner, LA 70062", zip_code: "70062" } }, new Set(["70130"]));
  assert.equal(p.image, "https://nolaatlas.com/og/property.png");
  assert.equal(p.description, "Flood risk, the true monthly cost and the market around it, on NOLA Atlas.");
  assert.equal(describeOwner({ name: "X LLC", count: 2, parishes: { jefferson: 1, orleans: 1 } }).description.includes("Jefferson and Orleans Parish Assessor's rolls"), true);
});

test("lookups under their tab's path (the app's links) resolve like the older home-page ones", async () => {
  assert.match((await preview("q=Parcel+103109601", "/property/")).title, /^1 Poydras St, New Orleans, LA 70130 \(tax bill 103109601\)/);
  assert.match((await preview("owner=housing-authority-of-new-orleans", "/ownership/jefferson/")).title, /^Housing Authority of New Orleans/);
  assert.equal(await preview("", "/property/"), null);
  assert.equal(await preview("geo=zip%3A70130", "/ownership/"), null);
});
