// Keeps FloodLens awake. It runs on Render's free plan, which puts a service to sleep after 15
// minutes without a request, so the first property report after a quiet spell waited up to a
// minute for its flood details. The Worker's cron trigger (wrangler.toml) calls its health check
// every 10 minutes instead; Cloudflare's free plan includes cron triggers.
//
// Render's free plan gives a workspace 750 instance hours a month. One service awake all month
// uses 720-744, so this fits only while FloodLens is the workspace's one free service.

// The onrender.com address answers whatever happens to the custom domain's DNS.
export const FLOODLENS_HEALTH = "https://nola-floodlens.onrender.com/api/health";
const TIMEOUT_MS = 90_000; // a cold start can take about a minute

/** One health check; resolves to the HTTP status, or null when it failed. Never throws. */
export async function pingFloodLens(fetchFn = fetch, url = FLOODLENS_HEALTH) {
  try {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "User-Agent": "nolaatlas-keep-awake" } });
    console.log(`FloodLens health: ${res.status}`);
    return res.status;
  } catch (e) {
    console.log(`FloodLens health check failed: ${e?.message || e}`);
    return null;
  }
}
