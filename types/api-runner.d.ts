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
export function discoverApiRoutes(apiDir: string): ApiRoute[];
/**
 * Match a request pathname against discovered routes. The pathname is expected
 * to start with `/api`; anything else returns `null` (caller serves static).
 * @param {ApiRoute[]} routes
 * @param {string} pathname Request pathname (no query string).
 * @returns {{ file: string, params: Record<string, string> } | null}
 */
export function matchApiRoute(routes: ApiRoute[], pathname: string): {
    file: string;
    params: Record<string, string>;
} | null;
/**
 * Build a Web-standard `Request` from a Node `IncomingMessage`. The body (for
 * methods that carry one) is buffered fully — dev endpoints are small and this
 * avoids the `duplex: "half"` streaming dance.
 * @param {import("node:http").IncomingMessage} req
 * @returns {Promise<Request>}
 */
export function nodeRequestToWeb(req: import("node:http").IncomingMessage): Promise<Request>;
/**
 * Write a Web-standard `Response` back onto a Node `ServerResponse`.
 * @param {Response} response
 * @param {import("node:http").ServerResponse} res
 * @returns {Promise<void>}
 */
export function writeWebResponse(response: Response, res: import("node:http").ServerResponse): Promise<void>;
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
export function handleApiRequest({ apiDir, req, res }: {
    apiDir: string;
    req: import("node:http").IncomingMessage;
    res: import("node:http").ServerResponse;
}): Promise<boolean>;
/**
 * A discovered API route.
 */
export type ApiRoute = {
    /**
     * Absolute path to the handler module.
     */
    file: string;
    /**
     * Route segments after `/api`; a dynamic segment
     * is stored as `[name]` (e.g. `["users", "[id]"]`).
     */
    segments: string[];
};
