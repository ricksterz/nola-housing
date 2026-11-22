import assert from "node:assert/strict";
import { test } from "node:test";
import { cellsAround, distanceM, fmtDistance, nearKey, nearestHomes } from "../src/lib/nearby.js";
import { admissionLabel, kindLabel, milesBetween, schoolLink, schoolsByDistance } from "../src/lib/schools.js";

const LAT = 29.9841;
const LNG = -90.1521;

test("nearby homes: every point within the radius lies in one of the cells loaded", () => {
  const cells = new Set(cellsAround(LAT, LNG));
  // Points on the 400 m circle (and the center): due north and south used to be missed.
  for (let deg = 0; deg < 360; deg += 5) {
    const a = (deg * Math.PI) / 180;
    const lat = LAT + (399 * Math.cos(a)) / 111320;
    const lng = LNG + (399 * Math.sin(a)) / (111320 * Math.cos((LAT * Math.PI) / 180));
    assert.ok(cells.has(nearKey(lat, lng)), `missing the cell ${deg}° from the address`);
  }
  assert.ok(cells.has(nearKey(LAT, LNG)));
  assert.equal(cells.size, 6); // 2 rows × 3 columns here; never the whole grid
});

test("nearby homes: inside the radius, nearest first, without the address itself or repeats", () => {
  const rows = [
    ["far", "k1", LAT + 0.01, LNG, 1, 2, "X"], // ~1.1 km
    ["self", "self", LAT, LNG, 1, 2, "X"],
    ["near", "k2", LAT + 0.001, LNG, 1, 2, "AE"], // ~111 m
    ["nearer", "k3", LAT + 0.0005, LNG, 1, 2, "X"],
    ["nearer again", "k3", LAT + 0.0005, LNG, 1, 2, "X"],
  ];
  const out = nearestHomes(rows, LAT, LNG, { selfKey: "self" });
  assert.deepEqual(out.map((h) => h.street), ["nearer", "near"]);
  assert.ok(Math.abs(out[1].d - 111.2) < 1);
  assert.equal(nearestHomes(rows, LAT, LNG, { selfKey: "self", limit: 1 }).length, 1);
});

test("distances", () => {
  assert.ok(Math.abs(distanceM(LAT, LNG, LAT + 0.001, LNG) - 111.2) < 1);
  assert.equal(fmtDistance(100), "330 ft");
  assert.equal(fmtDistance(1609.34), "1.0 mi");
  // The haversine miles agree with the meters to well under 1% at this scale.
  assert.ok(Math.abs(milesBetween(LAT, LNG, LAT + 0.01, LNG) * 1609.34 - distanceM(LAT, LNG, LAT + 0.01, LNG)) < 5);
});

test("schools: nearest first, labeled, linked to School Finder with the ZIP as home", () => {
  const schools = [
    { slug: "far", lat: LAT + 0.05, lng: LNG, kind: "catholic" },
    { slug: "near", lat: LAT + 0.01, lng: LNG, kind: "public", charter: true, admission: "charter_lottery" },
  ];
  assert.deepEqual(schoolsByDistance(schools, LAT, LNG).map((s) => s.slug), ["near", "far"]);
  assert.deepEqual(schoolsByDistance(null, LAT, LNG), []);
  assert.equal(kindLabel(schools[1]), "Public charter");
  assert.equal(kindLabel({ kind: "private" }), "Private");
  assert.equal(admissionLabel(schools[1]), "Charter lottery");
  assert.equal(admissionLabel(schools[0]), null);
  assert.equal(schoolLink(schools[1], "70005"), "https://schools.nolaatlas.com/?school=near&zip=70005");
  assert.equal(schoolLink(schools[1]), "https://schools.nolaatlas.com/?school=near");
});
