// Cloudflare Worker on nolaatlas.com/ (the home path only; every other page is untouched): fills
// the link-preview tags of property and owner lookups, which share the home page's HTML, with
// that property's or owner's details. See meta.js. Deploy: `npx wrangler deploy` in this folder.

import { previewFor } from "./meta.js";

const CACHE_SECONDS = 3600;

async function getJson(origin, path) {
  const res = await fetch(new URL(path, origin), { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } });
  if (!res.ok) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function setContent(meta) {
  return { element: (el) => el.setAttribute("content", meta) };
}

export default {
  async fetch(request) {
    const res = await fetch(request);
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/" || !(res.headers.get("content-type") || "").includes("text/html")) {
      return res;
    }
    let preview = null;
    try {
      preview = await previewFor(url, (path) => getJson(url.origin, path));
    } catch {
      preview = null; // a lookup problem must never break the page
    }
    if (!preview) return res;
    const shared = url.href;
    return new HTMLRewriter()
      .on("title", { element: (el) => el.setInnerContent(preview.title) })
      .on('meta[name="description"]', setContent(preview.description))
      .on('meta[property="og:title"]', setContent(preview.title))
      .on('meta[property="og:description"]', setContent(preview.description))
      .on('meta[property="og:url"]', setContent(shared))
      .on('meta[property="og:image"]', setContent(preview.image))
      .on('meta[property="og:image:alt"]', setContent(preview.imageAlt))
      .on('meta[name="twitter:title"]', setContent(preview.title))
      .on('meta[name="twitter:description"]', setContent(preview.description))
      .on('meta[name="twitter:image"]', setContent(preview.image))
      .transform(res);
  },
};
