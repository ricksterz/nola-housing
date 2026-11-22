import assert from "node:assert/strict";
import { test } from "node:test";
import { SEQ_DARK, SEQ_LIGHT, diverging, fmt, fmtCompactCurrency, monthlyPayment, readableOn, sequential } from "../src/lib/theme.js";

function luminance(hex) {
  const n = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(n.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("text on every heat-map fill meets WCAG AA (4.5:1) in both themes", () => {
  const fills = [...SEQ_LIGHT, ...SEQ_DARK];
  for (const theme of ["light", "dark"]) for (let t = -1; t <= 1; t += 0.05) fills.push(diverging(t, theme));
  for (const fill of fills) {
    const ink = readableOn(fill);
    assert.ok(contrast(fill, ink) >= 4.5, `${ink} on ${fill}: ${contrast(fill, ink).toFixed(2)}:1`);
  }
});

test("ramps: ends, clamping and missing values", () => {
  assert.equal(sequential(0, "light"), SEQ_LIGHT[0]);
  assert.equal(sequential(1, "dark"), SEQ_DARK.at(-1));
  assert.equal(sequential(7, "light"), SEQ_LIGHT.at(-1));
  assert.equal(sequential(null, "light"), "transparent");
  assert.equal(diverging(0.05, "light"), "#f0efec");
  assert.equal(diverging(NaN, "dark"), "transparent");
  assert.equal(readableOn("red"), undefined);
});

test("number formats", () => {
  assert.equal(fmtCompactCurrency(1250000), "$1.25M");
  assert.equal(fmtCompactCurrency(1500000), "$1.5M");
  assert.equal(fmtCompactCurrency(281100), "$281K");
  assert.equal(fmtCompactCurrency(950), "$950");
  assert.equal(fmt.signedPct(-0.04), "0%");
  assert.equal(fmt.signedPct(2.345), "+2.3%");
  assert.equal(fmt.signedPct(-1.2), "-1.2%");
  assert.equal(fmt.date("2024-03-05"), "Mar 5, 2024");
  assert.equal(fmt.date("2024-03"), "Mar 2024");
  assert.equal(fmt.monthYear("2024-11-01"), "Nov 2024");
  assert.equal(fmt.currency(null), "—");
});

test("30-year payment", () => {
  assert.ok(Math.abs(monthlyPayment(240000, 6.5) - 1516.96) < 0.01);
  assert.equal(monthlyPayment(360000, 0), 1000);
  assert.equal(monthlyPayment(0, 6.5), null);
  assert.equal(monthlyPayment(240000, null), null);
});
