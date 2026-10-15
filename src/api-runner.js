import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendVary, compressBody, isCompressibleType, negotiateEncoding } from "./statics.js";

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
 * A dynamic segment whose percent-encoding is malformed (`%E0%A4%A`) makes
 * `decodeURIComponent` throw — that is reported as `{ malformed: true }` so the
 * caller answers a clean 400 instead of crashing the request handler.
 * @param {ApiRoute[]} routes
 * @param {string} pathname Request pathname (no query string).
 * @returns {{ file: string, params: Record<string, string> } | { malformed: true } | null}
 */
export function matchApiRoute(routes, pathname) {
  if (pathname !== "/api" && !pathname.startsWith("/api/")) return null;
  const parts = pathname.split("/").filter(Boolean).slice(1); // drop leading "api"
  let sawMalformed = false;
  for (const route of routes) {
    if (route.segments.length !== parts.length) continue;
    /** @type {Record<string, string>} */
    const params = {};
    let ok = true;
    for (let i = 0; i < parts.length; i++) {
      const seg = route.segments[i];
      if (seg.startsWith("[") && seg.endsWith("]")) {
        try {
          params[seg.slice(1, -1)] = decodeURIComponent(parts[i]);
        } catch {
          // Malformed here does not preclude a static match on a later route,
          // so keep scanning and report only if nothing else claimed the path.
          sawMalformed = true;
          ok = false;
          break;
        }
      } else if (seg !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return { file: route.file, params };
  }
  return sawMalformed ? { malformed: true } : null;
}

/**
 * Build a Web-standard `Request` from a Node `IncomingMessage`. The body (for
 * methods that carry one) is buffered up to {@link MAX_BODY_BYTES} — dev and
 * preview endpoints are small and this avoids the `duplex: "half"` streaming
 * dance. A larger body rejects with {@link BodyTooLargeError}, which
 * `handleApiRequest` answers as a 413.
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

/** Bodies larger than this are rejected with a 413 rather than buffered without bound. */
const MAX_BODY_BYTES = 10 * 1024 * 1024;

/**
 * Rejection marker for an over-cap request body, so `handleApiRequest` answers
 * 413 (a client error) instead of a generic 500.
 */
class BodyTooLargeError extends Error {}

/**
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let received = 0;
    let over = false;
    req.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        // Stop accumulating, but keep draining the socket: destroying the
        // request here would kill the connection before the 413 answer can
        // reach the client (verified: `req.destroy()` mid-upload → EPIPE).
        if (!over) {
          over = true;
          reject(new BodyTooLargeError(`Request body too large (over ${MAX_BODY_BYTES} bytes)`));
        }
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Write a Web-standard `Response` back onto a Node `ServerResponse`.
 *
 * `acceptEncoding` is the request's Accept-Encoding header when the caller
 * negotiates compression (the preview server); a JSON/text/svg body is then
 * sent brotli- or gzip-compressed with `Content-Encoding` + `Vary`. When it
 * is omitted (the dev server) the response is written exactly as before — no
 * re-encoding, no extra headers. A handler that already set Content-Encoding
 * is never double-compressed.
 * @param {Response} response
 * @param {import("node:http").ServerResponse} res
 * @param {string | string[] | undefined} [acceptEncoding]
 * @returns {Promise<void>}
 */
export async function writeWebResponse(response, res, acceptEncoding) {
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
  let buffer = /** @type {Buffer} */ (Buffer.from(await response.arrayBuffer()));
  const encoding = negotiateEncoding(acceptEncoding);
  if (encoding && isCompressibleType(String(headers["content-type"] || ""))) {
    if (!headers["content-encoding"]) {
      headers["content-encoding"] = encoding;
      headers.vary = appendVary(
        /** @type {string | undefined} */ (headers.vary),
        "Accept-Encoding"
      );
      buffer = compressBody(buffer, encoding);
    }
  }
  res.writeHead(response.status, headers);
  res.end(buffer);
}

/**
 * Handle a request as an API call if its pathname matches a function under
 * `apiDir`. Returns `true` when it owned the request (a route matched, whether
 * the handler succeeded or threw), `false` when nothing matched so the caller
 * should fall through to static serving.
 *
 * Error disclosure: a handler throw is answered as JSON either way, but the
 * `error` field carries the real message only when `discloseErrors` is set
 * (the dev server's default — a documented dev convenience). The preview
 * server passes `false` and the client gets the generic "Internal error",
 * matching the shape the generated Cloudflare worker ships.
 *
 * @param {object} io
 * @param {string} io.apiDir Absolute path to the project's `api/` directory.
 * @param {import("node:http").IncomingMessage} io.req
 * @param {import("node:http").ServerResponse} io.res
 * @param {string | string[] | undefined} [io.acceptEncoding] The request's
 *   Accept-Encoding header, when the caller negotiates compression (preview).
 * @param {boolean} [io.discloseErrors] Echo the thrown message to the client
 *   (default true, the dev behavior). Pass false on any production-shaped path.
 * @returns {Promise<boolean>}
 */
export async function handleApiRequest({
  apiDir,
  req,
  res,
  acceptEncoding,
  discloseErrors = true
}) {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const match = matchApiRoute(discoverApiRoutes(apiDir), pathname);
  if (!match) return false;
  if ("malformed" in match) {
    // A malformed percent-encoded dynamic segment: the URL itself is at fault,
    // so this is a 400, not a 500 — and it must never reach the caller's catch.
    await writeWebResponse(
      Response.json({ ok: false, error: "Malformed URL encoding" }, { status: 400 }),
      res
    );
    return true;
  }

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
    await writeWebResponse(response, res, acceptEncoding);
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      await writeWebResponse(
        Response.json({ ok: false, error: "Request body too large" }, { status: 413 }),
        res
      );
      return true;
    }
    const message = discloseErrors
      ? err instanceof Error
        ? err.message
        : String(err)
      : "Internal error";
    await writeWebResponse(Response.json({ ok: false, error: message }, { status: 500 }), res);
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
