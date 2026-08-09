// Live project stats for the darkmown.com landing page: the published npm
// version, monthly npm downloads, and the GitHub star count, fetched
// server-side and returned as one small JSON payload.
//
// Why a proxy rather than `:fetch`-ing GitHub and npm directly from the page:
// Darkmown ships `connect-src 'self'` in its CSP, so a cross-origin `:fetch`
// is blocked by the framework's own policy. Going through a same-origin `api/`
// function keeps the strict CSP intact, keeps third-party hosts off the
// homepage entirely, and demonstrates the intended pairing: `:fetch` reading
// from an `api/` serverless function.
//
// Part of the demo-site deployment, not the framework. Web-standard
// `(request) => Response`, so it runs identically under `darkmown dev`, on
// Vercel Edge, and on Cloudflare Pages.
export const config = { runtime: "edge" };

const REPO = "ZVN-DEV/darkmown";
const PKG = "@zvndev/darkmown";

export default async function () {
  // Never let one slow or rate-limited upstream fail the whole strip: each
  // source degrades to null independently and the page renders what it has.
  //
  // `stars` is served but not currently displayed. The landing page shows
  // `version` in that slot instead, because a low star count on a young
  // project reads as evidence against it. Flipping the strip back to stars is
  // a label change in site/pages/index.wd, not a change here.
  const [version, downloads, stars] = await Promise.all([
    fetchVersion(),
    fetchDownloads(),
    fetchStars()
  ]);

  return Response.json(
    { version, downloads, stars },
    {
      headers: {
        // Cache at the edge: these numbers do not need to be per-request fresh,
        // and GitHub rate-limits unauthenticated calls at 60/hour per IP.
        "cache-control": "public, s-maxage=900, stale-while-revalidate=3600"
      }
    }
  );
}

/**
 * The version npm actually resolves for `npm i @zvndev/darkmown`, read from the
 * registry rather than package.json so the page cannot claim a release that was
 * never published.
 *
 * @returns {Promise<string | null>}
 */
async function fetchVersion() {
  try {
    const response = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(PKG)}/latest`,
      { headers: { accept: "application/json" } }
    );
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<number | null>} */
async function fetchStars() {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "darkmown.com" }
    });
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.stargazers_count === "number" ? body.stargazers_count : null;
  } catch {
    return null;
  }
}

/** @returns {Promise<number | null>} */
async function fetchDownloads() {
  try {
    const response = await fetch(
      `https://api.npmjs.org/downloads/point/last-month/${encodeURIComponent(PKG)}`
    );
    if (!response.ok) return null;
    const body = await response.json();
    return typeof body.downloads === "number" ? body.downloads : null;
  } catch {
    return null;
  }
}
