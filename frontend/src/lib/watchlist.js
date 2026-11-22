// The reader's watchlist: addresses, ZIP codes and owners they saved. It lives only in this
// browser (localStorage): nothing is sent anywhere, so About's privacy answer holds. Where storage
// is blocked (private mode, a full quota) the list still works until the tab closes.
//
// An item is { type, id, label, savedAt }:
//   property  id = the lookup text that opens its report (/property/?q=<id>), as Copy link uses
//   zip       id = the five-digit ZIP (/market/<id>/)
//   owner     id = the owner page's slug (/ownership/?owner=<id>)
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
    out.push({ type: it.type, id: it.id, label: typeof it.label === "string" && it.label ? it.label : it.id, savedAt: typeof it.savedAt === "string" ? it.savedAt : null });
  }
  return out.slice(0, MAX_ITEMS);
}

export const itemKey = (it) => `${it.type}:${it.id}`;

export const hasItem = (list, type, id) => list.some((it) => it.type === type && it.id === id);

/** The list with one item added at the front (newest first); a repeat moves it to the front. */
export function addItem(list, { type, id, label }, now = new Date()) {
  if (!WATCH_TYPES.includes(type) || !id) return list;
  const rest = list.filter((it) => !(it.type === type && it.id === id));
  return [{ type, id, label: label || id, savedAt: now.toISOString() }, ...rest].slice(0, MAX_ITEMS);
}

export const removeItem = (list, type, id) => list.filter((it) => !(it.type === type && it.id === id));

// One shared copy for every Save button and the dashboard, kept in step across tabs.
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

/** The list, plus toggle/remove/clear that update every component showing it. */
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
    full: list.length >= MAX_ITEMS,
  };
}
