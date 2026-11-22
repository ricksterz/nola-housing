// Watchlist sync: the same list on every device that has the sync code. The code is made and kept
// in the browser; from it come three values (HKDF-SHA-256): an id for the server's row, a write
// token, and an AES-GCM key. The list is encrypted here before it leaves, so the server
// (cloudflare/watchlist-sync) stores something it can't read, under a code it never sees.
// Anyone with the code can read and change the list, so the page says to share it only with
// people who should.
//
// Sync runs only once the reader turns it on (or joins with a code): until then nothing about the
// watchlist leaves the browser.
import { useEffect, useState } from "react";
import { applyState, getState, mergeState, sameState, watchState } from "./watchlist.js";

const API = "/api/sync";
const CONF_KEY = "nola-watchlist-sync";
// Crockford base32: no I, L, O or U, so a code read aloud or typed from a phone survives.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CODE_LENGTH = 20; // 100 random bits

// ---- The code -------------------------------------------------------------------------------

export function newCode(random = (n) => crypto.getRandomValues(new Uint8Array(n))) {
  return [...random(CODE_LENGTH)].map((b) => ALPHABET[b & 31]).join("");
}

/** A typed or pasted code, cleaned: case, spaces and dashes ignored, I/L read as 1 and O as 0.
 *  Null when it can't be a code. */
export function normalizeCode(input) {
  const s = String(input || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
  return s.length === CODE_LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

/** "ABCD-EFGH-JKMN-PQRS-TVWX": groups of four for reading and typing. */
export const formatCode = (code) => code.match(/.{1,4}/g).join("-");

// ---- Keys and sealing ------------------------------------------------------------------------

const enc = new TextEncoder();
const SALT = enc.encode("nolaatlas-watchlist-sync-v1");
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function b64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** The row id, write token and encryption key for a code. */
export async function keysFor(code) {
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "HKDF", false, ["deriveBits", "deriveKey"]);
  const bits = (info) => crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode(info) }, base, 256);
  const key = await crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: SALT, info: enc.encode("key") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return { id: hex(await bits("id")), auth: hex(await bits("auth")), key };
}

/** A list encrypted for the server: base64url of a random 12-byte IV and the AES-GCM ciphertext,
 *  bound to its row id so it can't be moved to another. */
export async function seal(keys, state) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(keys.id) }, keys.key, enc.encode(JSON.stringify({ v: 1, ...state })));
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return b64url(out);
}

/** The list back from the server; throws when it was tampered with or the code is wrong. */
export async function unseal(keys, data) {
  const bytes = fromB64url(data);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: enc.encode(keys.id) }, keys.key, bytes.slice(12));
  const obj = JSON.parse(new TextDecoder().decode(pt));
  return { items: obj.items || [], removed: obj.removed || {} };
}

// ---- One round trip ----------------------------------------------------------------------------

export class SyncError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // "offline" | "missing" | "forbidden" | "server"
  }
}

async function request(fetchFn, method, id, body) {
  let res;
  try {
    res = await fetchFn(`${API}/${id}`, {
      method,
      cache: "no-store",
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new SyncError("offline", "Couldn't reach sync. Your list is still saved here and will sync next time.");
  }
  if (res.status === 404 && method === "GET") return null;
  if (res.status === 403) throw new SyncError("forbidden", "This code can read the list but not change it. Turn sync off and on again.");
  if (res.status === 409) return { conflict: await res.json() };
  if (!res.ok) throw new SyncError("server", "Sync isn't answering right now. Your list is still saved here.");
  return res.status === 204 ? {} : res.json();
}

/** Pull the server's copy, merge it with this browser's, and push the result if it differs.
 *  ``create`` allows a first write (turning sync on); joining with a code never creates a list,
 *  so a mistyped code can't start a new empty one. Returns { state, rev }. */
export async function syncOnce({ code, local, create = false, fetchFn = fetch }) {
  const keys = await keysFor(code);
  let remote = await request(fetchFn, "GET", keys.id);
  if (!remote && !create) throw new SyncError("missing", "No synced list goes with that code. Check it and try again.");
  for (let attempt = 0; attempt < 3; attempt++) {
    const rev = remote?.rev ?? 0;
    const theirs = remote ? await unseal(keys, remote.data) : null;
    const merged = theirs ? mergeState(local, theirs) : mergeState(local, { items: [], removed: {} });
    if (theirs && sameState(merged, theirs)) return { state: merged, rev };
    const res = await request(fetchFn, "PUT", keys.id, { rev, auth: keys.auth, data: await seal(keys, merged) });
    if (!res.conflict) return { state: merged, rev: res.rev };
    remote = res.conflict; // someone else wrote first: merge with theirs and try again
    local = merged;
  }
  throw new SyncError("server", "The list kept changing on another device. Try again in a moment.");
}

/** Delete the server's copy. */
export async function deleteRemote(code, fetchFn = fetch) {
  const keys = await keysFor(code);
  await request(fetchFn, "DELETE", keys.id, { auth: keys.auth });
}

/** Whether this site has sync (the Worker answers /api/sync/health). */
export async function syncAvailable(fetchFn = fetch) {
  try {
    const res = await fetchFn(`${API}/health`, { cache: "no-store" });
    return res.ok && (await res.json()).ok === true;
  } catch {
    return false;
  }
}

// ---- The engine --------------------------------------------------------------------------------

function readConf() {
  try {
    const c = JSON.parse(localStorage.getItem(CONF_KEY) || "null");
    return c && normalizeCode(c.code) ? c : null;
  } catch {
    return null;
  }
}

function writeConf(c) {
  try {
    if (c) localStorage.setItem(CONF_KEY, JSON.stringify(c));
    else localStorage.removeItem(CONF_KEY);
  } catch {
    /* private mode: sync lasts until the tab closes */
  }
}

let conf = typeof window === "undefined" ? null : readConf();
let status = { busy: false, error: null, lastSync: conf?.lastSync || null };
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn({ ...status, on: Boolean(conf), code: conf?.code || null }));
const set = (patch) => {
  status = { ...status, ...patch };
  emit();
};

let running = null;
let again = false;

/** Sync now (one at a time; a change during a sync runs another right after). */
export function syncNow({ create = false } = {}) {
  if (!conf) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  set({ busy: true });
  running = syncOnce({ code: conf.code, local: getState(), create })
    .then(({ state }) => {
      if (!sameState(state, getState())) applyState(state);
      conf = { ...conf, lastSync: new Date().toISOString() };
      writeConf(conf);
      set({ busy: false, error: null, lastSync: conf.lastSync });
    })
    .catch((e) => {
      if (e.kind === "missing" && conf?.lastSync) {
        // It synced before, so the list was deleted (from another device): stop here too.
        conf = null;
        writeConf(null);
        e = new SyncError("missing", "The synced copy was deleted, so sync is off here. Your list is still saved in this browser.");
      }
      set({ busy: false, error: e instanceof SyncError ? e : new SyncError("server", "Sync failed. Your list is still saved here.") });
      throw e;
    })
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow().catch(() => {});
      }
    });
  return running;
}

let timer = null;
let started = false;

/** Start syncing in the background (App mount): now, after each change here, and whenever the
 *  page comes back into view. Does nothing until sync is on. */
export function startSync() {
  if (started || typeof window === "undefined") return;
  started = true;
  watchState((_, source) => {
    if (!conf || source === "sync") return;
    clearTimeout(timer);
    timer = setTimeout(() => syncNow().catch(() => {}), 1500);
  });
  let last = 0;
  const onVisible = () => {
    if (document.visibilityState !== "visible" || !conf || Date.now() - last < 30000) return;
    last = Date.now();
    syncNow().catch(() => {});
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("storage", (e) => {
    if (e.key === CONF_KEY) {
      conf = readConf();
      emit();
    }
  });
  onVisible();
}

/** Turn sync on with a new code, storing this browser's list under it. */
export async function enableSync() {
  conf = { code: newCode() };
  writeConf(conf);
  emit();
  try {
    await syncNow({ create: true });
  } catch (e) {
    if (e.kind !== "offline") disableSync();
    throw e;
  }
}

/** Join a list made on another device: its items and this browser's are combined. */
export async function joinSync(input) {
  const code = normalizeCode(input);
  if (!code) throw new SyncError("missing", `A sync code has ${CODE_LENGTH} letters and numbers. Check it and try again.`);
  const before = conf;
  conf = { code };
  try {
    await syncNow();
    writeConf(conf);
    emit();
  } catch (e) {
    conf = before; // a wrong code leaves things as they were
    emit();
    throw e;
  }
}

/** Stop syncing on this device; with ``remove``, delete the server's copy too (every device). */
export async function disableSync({ remove = false } = {}) {
  const code = conf?.code;
  if (remove && code) await deleteRemote(code);
  conf = null;
  writeConf(null);
  set({ error: null, lastSync: null });
}

/** Sync's state for a component: { on, code, busy, error, lastSync }. */
export function useSync() {
  const [s, setS] = useState(() => ({ ...status, on: Boolean(conf), code: conf?.code || null }));
  useEffect(() => {
    listeners.add(setS);
    return () => listeners.delete(setS);
  }, []);
  return s;
}
