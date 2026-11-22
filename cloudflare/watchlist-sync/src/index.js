// Watchlist sync for nolaatlas.com (route nolaatlas.com/api/sync/*, wrangler.toml). The browser
// turns a sync code into three values (frontend/src/lib/sync.js): an id, a write token and an
// encryption key. Only the id, the token and the encrypted list ever reach this Worker, so it
// stores lists it can't read, for codes it never sees.
//
//   GET    /api/sync/health   {ok: true}: the site shows its Sync panel only when this answers
//   GET    /api/sync/<id>     {rev, data} or 404
//   PUT    /api/sync/<id>     {rev, auth, data}: rev is the version the browser last saw (0 for a
//                             new list); 409 with the current {rev, data} when it's out of date
//   DELETE /api/sync/<id>     {auth}: removes the list

const ID = /^[0-9a-f]{64}$/;
export const MAX_DATA = 64 * 1024; // a full 60-item list encrypts to well under 32 KB
const KEEP_DAYS = 400;
const ORIGINS = new Set(["https://nolaatlas.com", "https://www.nolaatlas.com"]);

function json(body, status = 200) {
  return new Response(body == null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readBody(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_DATA + 1024) return null;
  const text = await request.text();
  if (text.length > MAX_DATA + 1024) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const current = (db, id) => db.prepare("SELECT rev, data FROM lists WHERE id = ?").bind(id).first();

async function put(db, id, body) {
  const { rev, auth, data } = body || {};
  if (!Number.isInteger(rev) || rev < 0 || typeof auth !== "string" || !ID.test(auth)) return json({ error: "bad request" }, 400);
  if (typeof data !== "string" || !data || data.length > MAX_DATA || !/^[A-Za-z0-9_-]+$/.test(data)) return json({ error: "bad data" }, 400);
  const hash = await sha256Hex(auth);
  const now = new Date().toISOString();
  if (rev === 0) {
    const r = await db
      .prepare("INSERT INTO lists (id, auth_hash, rev, data, updated_at) VALUES (?, ?, 1, ?, ?) ON CONFLICT (id) DO NOTHING")
      .bind(id, hash, data, now)
      .run();
    if (r.meta.changes === 1) return json({ rev: 1 });
  } else {
    const r = await db
      .prepare("UPDATE lists SET rev = rev + 1, data = ?, updated_at = ? WHERE id = ? AND rev = ? AND auth_hash = ?")
      .bind(data, now, id, rev, hash)
      .run();
    if (r.meta.changes === 1) return json({ rev: rev + 1 });
  }
  // Nothing written: tell apart a missing list, a wrong token and a stale version.
  const row = await db.prepare("SELECT rev, data, auth_hash FROM lists WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not found" }, 404);
  if (row.auth_hash !== hash) return json({ error: "forbidden" }, 403);
  return json({ rev: row.rev, data: row.data }, 409);
}

async function remove(db, id, body) {
  const auth = body?.auth;
  if (typeof auth !== "string" || !ID.test(auth)) return json({ error: "bad request" }, 400);
  const r = await db.prepare("DELETE FROM lists WHERE id = ? AND auth_hash = ?").bind(id, await sha256Hex(auth)).run();
  if (r.meta.changes === 1) return json(null, 204);
  return (await current(db, id)) ? json({ error: "forbidden" }, 403) : json(null, 204);
}

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/sync\/?/, "");
  // Same-origin only: the site calls this from its own pages. A browser on another site gets
  // no CORS headers, so it can neither read an answer nor send a JSON PUT or DELETE.
  const origin = request.headers.get("origin");
  if (origin && !ORIGINS.has(origin)) return json({ error: "forbidden" }, 403);
  if (path === "health" && request.method === "GET") return json({ ok: true });
  if (!ID.test(path)) return json({ error: "not found" }, 404);
  if (request.method === "GET") {
    const row = await current(env.DB, path);
    return row ? json({ rev: row.rev, data: row.data }) : json({ error: "not found" }, 404);
  }
  if (request.method === "PUT" || request.method === "DELETE") {
    if (!(request.headers.get("content-type") || "").startsWith("application/json")) return json({ error: "json only" }, 415);
    const body = await readBody(request);
    if (!body) return json({ error: "bad request" }, 400);
    return request.method === "PUT" ? put(env.DB, path, body) : remove(env.DB, path, body);
  }
  return json({ error: "method not allowed" }, 405);
}

/** Lists nobody has synced for KEEP_DAYS. */
export async function sweep(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - KEEP_DAYS * 86400000).toISOString();
  const r = await db.prepare("DELETE FROM lists WHERE updated_at < ?").bind(cutoff).run();
  return r.meta.changes;
}

export default {
  async fetch(request, env) {
    try {
      return await handle(request, env);
    } catch {
      return json({ error: "unavailable" }, 503); // never echo details; the browser keeps its own copy
    }
  },
  scheduled(event, env, ctx) {
    ctx.waitUntil(sweep(env.DB));
  },
};
