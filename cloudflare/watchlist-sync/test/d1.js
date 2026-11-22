// A stand-in for Cloudflare D1 in tests: node:sqlite behind D1's prepare().bind().first()/run()
// API, with the real migrations applied.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).sort()) db.exec(readFileSync(new URL(f, dir), "utf8"));
  return {
    raw: db,
    prepare(sql) {
      const stmt = db.prepare(sql);
      const bound = (args) => ({
        first: async () => stmt.get(...args) ?? null,
        run: async () => ({ meta: { changes: Number(stmt.run(...args).changes) } }),
      });
      return { bind: (...args) => bound(args), ...bound([]) };
    },
  };
}
