-- One row per synced watchlist. The server never sees the sync code: `id` and the write token
-- are derived from it in the browser, `data` is the list encrypted there with a key also derived
-- from it. `auth_hash` is SHA-256 of the write token, so a leaked table can't be used to write.
CREATE TABLE lists (
  id TEXT PRIMARY KEY,
  auth_hash TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX lists_updated_at ON lists (updated_at);
