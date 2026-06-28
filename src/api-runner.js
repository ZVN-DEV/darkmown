import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The local-dev serverless API runner. Gives `darkmown dev` the SAME `/api/*`
 * behavior a project gets on Vercel / Cloudflare in production, so a `:fetch
 * /api/x` or a form POST works identically before you ever deploy.
 *
 * The convention is deliberately plain: a backend endpoint is a plain-JS file
 * under the project's top-level `api/` directory that default-exports a
 * Web-standard handler `(request: Request, context) => Response | Promise<Response>`.
 * That is the exact signature Vercel Edge, Cloudflare Pages, Netlify Edge and
 * Deno already run — Darkmown owns no server, it just emulates the host locally.
 *
 * File → route, rooted at the `/api` URL prefix (matching Vercel's `api/`):
 *   api/echo.js          → /api/echo
 *   api/users/index.js   → /api/users
 *   api/users/list.js    → /api/users/list
 *   api/users/[id].js    → /api/users/:id   (context.params.id)
 *
 * Nothing here mutates module state: routes are discovered per call so a newly
 * added function is picked up without a restart, and each handler is imported
 * with an mtime cache-buster so edits hot-reload.
 */

/**
 * A discovered API route.
 * @typedef {object} ApiRoute
 * @property {string} file Absolute path to the handler module.
 * @property {string[]} segments Route segments after `/api`; a dynamic segment
 *   is stored as `[name]` (e.g. `["users", "[id]"]`).
 */

/**
 * Walk `apiDir` and return every `.js`/`.mjs` handler as an {@link ApiRoute}.
 * Files/dirs whose name starts with `.`, `_`, or `-` are treated as private
 * (helpers, fixtures) and never routed, matching the router's hidden-path rule.
 * Returns `[]` when `apiDir` does not exist.
 * @param {string} apiDir Absolute path to the project's `api/` directory.
 * @returns {ApiRoute[]}
 */
export function discoverApiRoutes(apiDir) {
  if (!fs.existsSync(apiDir)) return [];
  /** @type {ApiRoute[]} */
  const routes = [];
  /** @param {string} dir @param {string[]} trail */
  const walk = (dir, trail) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (/^[._-]/.test(entry.name)) continue; // private: helpers, fixtures, drafts
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, [...trail, entry.name]);
        continue;
      }
      const ext = path.extname(entry.name);
      if (ext !== ".js" && ext !== ".mjs") continue;
      const base = entry.name.slice(0, -ext.length);
      // `index` collapses onto its directory: api/users/index.js → /api/users.
      const segments = base === "index" ? trail : [...trail, base];
      routes.push({ file: abs, segments });
    }
  };
  walk(apiDir, []);
  // Static routes before dynamic ones so an exact file always beats a `[param]`.
  return routes.sort((a, b) => dynamicCount(a.segments) - dynamicCount(b.segments));
}

/**
 * @param {string[]} segments
 * @returns {number} How many segments are dynamic (`[param]`).
 */
function dynamicCount(segments) {
  return segments.filter((s) => s.startsWith("[")).length;
}

/**
 * Match a request pathname against discovered routes. The pathname is expected
 * to start with `/api`; anything else returns `null` (caller serves static).
 * @param {ApiRoute[]} routes
 * @param {string} pathname Request pathname (no query string).
 * @returns {{ file: string, params: Record<string, string> } | null}
 */
export function matchApiRoute(routes, pathname) {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  const parts = pathname.split("/").filter(Boolean).slice(1); // drop leading "api"
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    /** @type {Record<string, string>} */
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i];
      if (seg.startsWith("[") && seg.endsWith("]")) {
        params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { file: route.file, params };
  }
  return null;
}

/**
 * Build a Web-standard `Request` from a Node `IncomingMessage`. The body (for
 * methods that carry one) is buffered fully — dev endpoints are small and this
 * avoids the `duplex: "half"` streaming dance.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Request>}
 */
export async function nodeRequestToWeb(req) {
  const host = req.headers.host || "localhost";
  const url = new URL(req.url || "/", `http://${host}`);
  /** @type {RequestInit} */
  const init = { method: req.method, headers: /** @type {HeadersInit} */ (req.headers) };
  const method = (req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    // A Node Buffer is a valid BodyInit at runtime; the DOM lib's narrower type
    // doesn't list it, so widen at the assignment.
    init.body = /** @type {BodyInit} */ (/** @type {unknown} */ (await readBody(req)));
  }
  return new Request(url, init);
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Write a Web-standard `Response` back onto a Node `ServerResponse`.
 * @param {Response} response
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
export async function writeWebResponse(response, res) {
  /** @type {Record<string, string | string[]>} */
  const headers = {};
  // `Headers.forEach` folds multiple Set-Cookie into one comma-joined value, which
  // corrupts cookies. Collect every other header here and emit Set-Cookie as a
  // discrete array (Node writeHead emits one header line per array element) so the
  // dev runner preserves the multi-cookie behavior the production hosts give.
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers[key] = value;
  });
  const cookies =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

/**
 * Handle a request as an API call if its pathname matches a function under
 * `apiDir`. Returns `true` when it owned the request (a route matched, whether
 * the handler succeeded or threw), `false` when nothing matched so the caller
 * should fall through to static serving.
 *
 * @param {object} io
 * @param {string} io.apiDir Absolute path to the project's `api/` directory.
 * @param {import("node:http").IncomingMessage} io.req
 * @param {import("node:http").ServerResponse} io.res
 * @returns {Promise<boolean>}
 */
export async function handleApiRequest({ apiDir, req, res }) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const match = matchApiRoute(discoverApiRoutes(apiDir), pathname);
  if (!match) return false;

  try {
    const handler = await importHandler(match.file);
    const request = await nodeRequestToWeb(req);
    const context = { params: match.params, env: process.env };
    const response = await handler(request, context);
    if (!(response instanceof Response)) {
      throw new TypeError(
        `api/${path.relative(apiDir, match.file)} must return a Response (got ${typeof response}). ` +
          "Use: return Response.json({ ... })"
      );
    }
    await writeWebResponse(response, res);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
  return true;
}

/**
 * Import a handler module fresh (mtime cache-buster) and return its default
 * export, validating it is callable.
 * @param {string} file Absolute path to the handler module.
 * @returns {Promise<(request: Request, context: { params: Record<string, string>, env: NodeJS.ProcessEnv }) => Response | Promise<Response>>}
 */
async function importHandler(file) {
  const mtime = fs.statSync(file).mtimeMs;
  const module = await import(`${pathToFileURL(file).href}?v=${mtime}`);
  const handler = module.default;
  if (typeof handler !== "function") {
    throw new TypeError(
      `${path.basename(file)} must \`export default\` a function (request) => Response.`
    );
  }
  return handler;
}
