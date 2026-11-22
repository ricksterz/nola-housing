import assert from "node:assert/strict";
import { test } from "node:test";
import { subdivisionName, titleCase } from "../src/lib/names.js";

test("the roll's LAST,FIRST form gets a comma and a space", () => {
  assert.equal(titleCase("SCHLANKER,WILLIAM A & AUBREY A"), "Schlanker, William A & Aubrey A");
  assert.equal(titleCase("NEW ORLEANS,CITY OF"), "New Orleans, City of");
  assert.equal(titleCase("SMITH ,  JOHN"), "Smith, John");
});

test("joining words are lower case except as a name's first word", () => {
  assert.equal(titleCase("THE ROMAN CATHOLIC CHURCH OF THE ARCHDIOCESE"), "The Roman Catholic Church of the Archdiocese");
  assert.equal(titleCase("HIGHWAY PK SQ 1 THRU 203"), "Highway Pk Sq 1 thru 203");
  // After a comma a new name starts; after "&" the next word is the same name continuing.
  assert.equal(titleCase("DOE,THE JANE TRUST"), "Doe, The Jane Trust");
});

test("company forms, initials and suffixes stay in capitals", () => {
  assert.equal(titleCase("ABC HOLDINGS LLC"), "Abc Holdings LLC");
  assert.equal(titleCase("JONES,ROBERT III"), "Jones, Robert III");
  assert.equal(titleCase("KH & JW METRO LAND"), "KH & JW Metro Land");
  assert.equal(titleCase("ACME INC"), "Acme Inc");
});

test("Mc, O' and spelled-out abbreviations", () => {
  assert.equal(titleCase("MCDONALD,MARY A & WF"), "McDonald, Mary A & wife");
  assert.equal(titleCase("O'BRIEN,JOHN P JR"), "O'Brien, John P Jr");
  assert.equal(titleCase("ST MARY'S ACADEMY"), "St Mary's Academy");
  assert.equal(titleCase("SMITH,JOHN ETAL"), "Smith, John et al");
  assert.equal(titleCase("DOE,JANE & HUS"), "Doe, Jane & husband");
});

test("empty and missing input", () => {
  assert.equal(titleCase(""), "");
  assert.equal(titleCase(null), "");
  assert.equal(titleCase(undefined), "");
});

test("subdivision names drop the roll's internal code", () => {
  assert.equal(subdivisionName("LAKE TRAIL_4544"), "Lake Trail");
  assert.equal(subdivisionName("BONNABEL PLACE"), "Bonnabel Place");
  assert.equal(subdivisionName("SQ 12_3"), "Sq 12");
  assert.equal(subdivisionName(null), "");
});
