// The reader's watchlist: addresses, ZIP codes and owners they saved. It lives only in this
// browser (localStorage): nothing is sent anywhere, so About's privacy answer holds. Where storage
// is blocked (private mode, a full quota) the list still works until the tab closes.
//
// An item is { type, id, label, savedAt, snap }:
//   property  id = the lookup text that opens its report (/property/?q=<id>), as Copy link uses
//   zip       id = the five-digit ZIP (/market/<id>/)
//   owner     id = the owner page's slug (/ownership/?owner=<id>)
// snap is what the item's numbers were when it was saved (or last marked seen), with the date:
// the dashboard compares it with the latest data to say what changed (changesSince).
import { useEffect, useState } from "react";

export const WATCH_TYPES = ["property", "zip", "owner"];
export const MAX_ITEMS = 60; // a generous personal list; the dashboard loads one file per property
const KEY = "nola-watchlist";

/** A stored value read back into a clean list: unknown types, duplicates and junk are dropped. */
export function parseList(raw) {
  let data;
  try {
    data = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return [];
  }
  const items = Array.isArray(data?.items) ? data.items : [];
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || !WATCH_TYPES.includes(it.type) || typeof it.id !== "string" || !it.id.trim()) continue;
    const k = itemKey(it);
    if (seen.has(k)) continue;
    seen.add(k);
    const item = { type: it.type, id: it.id, label: typeof it.label === "string" && it.label ? it.label : it.id, savedAt: typeof it.savedAt === "string" ? it.savedAt : null };
    if (it.snap && typeof it.snap === "object" && typeof it.snap.at === "string") item.snap = it.snap;
    out.push(item);
  }
  return out.slice(0, MAX_ITEMS);
}

export const itemKey = (it) => `${it.type}:${it.id}`;

export const hasItem = (list, type, id) => list.some((it) => it.type === type && it.id === id);

/** The list with one item added at the front (newest first); a repeat moves it to the front. */
export function addItem(list, { type, id, label, snap }, now = new Date()) {
  if (!WATCH_TYPES.includes(type) || !id) return list;
  const rest = list.filter((it) => !(it.type === type && it.id === id));
  const item = { type, id, label: label || id, savedAt: now.toISOString() };
  if (snap) item.snap = { ...snap, at: now.toISOString() };
  return [item, ...rest].slice(0, MAX_ITEMS);
}

export const removeItem = (list, type, id) => list.filter((it) => !(it.type === type && it.id === id));

/** The list with one item's snapshot replaced (a first baseline, or "mark as seen"). */
export function withSnapshot(list, type, id, snap, now = new Date()) {
  return list.map((it) => (it.type === type && it.id === id ? { ...it, snap: { ...snap, at: now.toISOString() } } : it));
}

// ---- What changed --------------------------------------------------------------------------

const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v) => (v == null || String(v).trim() === "" ? null : String(v).trim());

/** The numbers worth watching on an item, from the record its page shows: a property's parcel,
 *  a ZIP's scorecard row, an owner's page. Null when there's no record to read. */
export function snapshotOf(type, d) {
  if (!d) return null;
  if (type === "property") {
    return {
      owner: text(d.owner_name),
      assessed: num(d.assessed_val),
      exempt: num(d.exempt_val ?? d.homestead_exempt_val),
      market: num(d.tot_mkt_val),
      sale: d.last_sale_date || num(d.last_sale_price) ? `${d.last_sale_date || ""}|${num(d.last_sale_price) ?? ""}` : null,
      zone: text(d.flood_zone)?.toUpperCase() ?? null,
    };
  }
  if (type === "zip") {
    return { zhvi: num(d.zhvi), zhvi_month: text(d.zhvi_month), price: num(d.median_sale_price), price_month: text(d.price_month) };
  }
  if (type === "owner") return { count: num(d.count) };
  return null;
}

// Which fields count as a change, in the order they're listed. Months ride along with their
// values: a new month with the same value isn't news.
const FIELDS = {
  property: ["owner", "sale", "assessed", "market", "exempt", "zone"],
  zip: ["zhvi", "price"],
  owner: ["count"],
};
// A value has to move by this much to count (Zillow restates its index by a few dollars).
const MIN_PCT = { zhvi: 0.5, price: 0.5 };

/** What differs between a snapshot and the latest record: [{ key, from, to, pct? }], empty when
 *  nothing moved. A field missing from an old snapshot is never reported. */
export function changesSince(type, snap, current) {
  const now = snapshotOf(type, current);
  if (!snap || !now) return [];
  const out = [];
  for (const key of FIELDS[type] || []) {
    if (!(key in snap)) continue;
    const from = snap[key];
    const to = now[key];
    if (from === to || (from == null && to == null)) continue;
    const change = { key, from, to };
    if (typeof from === "number" && typeof to === "number" && from !== 0) {
      change.pct = ((to - from) / Math.abs(from)) * 100;
      if (MIN_PCT[key] != null && Math.abs(change.pct) < MIN_PCT[key]) continue;
    }
    if (type === "zip") change.month = now[`${key === "zhvi" ? "zhvi" : "price"}_month`];
    out.push(change);
  }
  return out;
}

// ---- Backup and share link -----------------------------------------------------------------

// The list rides in the link's #fragment, which browsers never send to a server (or to the
// analytics, which only ever see the page name). Base64url of {v:1, i:[[t, id, label?], ...]}.
const SHORT = { property: "p", zip: "z", owner: "o" };
const LONG = { p: "property", z: "zip", o: "owner" };

function toBase64Url(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** A list as the text after "#list=": types, ids and labels only (no snapshots). */
export function encodeList(list) {
  const i = list.map((it) => (it.label && it.label !== it.id ? [SHORT[it.type], it.id, it.label] : [SHORT[it.type], it.id]));
  return toBase64Url(JSON.stringify({ v: 1, i }));
}

/** A shared list read back (clean, as parseList), or null when the text isn't one. */
export function decodeList(s) {
  if (typeof s !== "string" || !s) return null;
  try {
    const data = JSON.parse(fromBase64Url(s));
    if (data?.v !== 1 || !Array.isArray(data.i)) return null;
    const items = data.i.filter(Array.isArray).map(([t, id, label]) => ({ type: LONG[t], id, label }));
    return parseList({ items });
  } catch {
    return null;
  }
}

/** Incoming items added after the reader's own, skipping ones already saved, up to the limit. */
export function mergeLists(mine, incoming, now = new Date()) {
  const out = [...mine];
  for (const it of incoming) {
    if (out.length >= MAX_ITEMS) break;
    if (!hasItem(out, it.type, it.id)) out.push({ type: it.type, id: it.id, label: it.label, savedAt: now.toISOString() });
  }
  return out;
}

// ---- The shared copy -----------------------------------------------------------------------

// One copy for every Save button and the dashboard, kept in step across tabs.
let memory = null;
const listeners = new Set();

function load() {
  if (memory) return memory;
  try {
    memory = parseList(localStorage.getItem(KEY));
  } catch {
    memory = [];
  }
  return memory;
}

function save(list) {
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, items: list }));
  } catch {
    /* private mode or full: the list lasts until the tab closes */
  }
  for (const fn of listeners) fn(list);
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY) return;
    memory = parseList(e.newValue);
    for (const fn of listeners) fn(memory);
  });
}

export function getWatchlist() {
  return load();
}

/** The list, plus the actions that update every component showing it. */
export function useWatchlist() {
  const [list, setList] = useState(load);
  useEffect(() => {
    listeners.add(setList);
    return () => listeners.delete(setList);
  }, []);
  return {
    list,
    has: (type, id) => hasItem(list, type, id),
    toggle: (item) => {
      const cur = load();
      const on = hasItem(cur, item.type, item.id);
      save(on ? removeItem(cur, item.type, item.id) : addItem(cur, item));
      return !on;
    },
    remove: (type, id) => save(removeItem(load(), type, id)),
    setSnapshot: (type, id, snap) => snap && save(withSnapshot(load(), type, id, snap)),
    importList: (incoming, { replace = false } = {}) => save(replace ? mergeLists([], incoming) : mergeLists(load(), incoming)),
    full: list.length >= MAX_ITEMS,
  };
}
