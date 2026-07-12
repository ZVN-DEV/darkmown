#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { handleApiRequest } from "./api-runner.js";
import { buildSite } from "./builder.js";
import { directiveCatalog, llmsText } from "./catalog.js";
import { createPaths } from "./config.js";
import { DEPLOY_TARGETS, deploy } from "./deploy.js";
import {
  buildFailedPage,
  createRebuildQueue,
  devClientPath,
  devClientScript,
  devEventsPath,
  injectDevClient
} from "./dev.js";
import { discoverRoutes, isDraft, outputPathForRoute } from "./router.js";
import { availableTemplates, initProject } from "./scaffold.js";
import { contentType, resolvePublicFile, serve } from "./statics.js";

const cliPath = fileURLToPath(import.meta.url);

/**
 * Run the Darkmown CLI. Extracted from the top-level script so every command
 * branch is unit-testable in-process: it never reads `process.argv` or calls
 * `process.exit` directly. Instead it takes the argv tail and an injectable
 * environment, RETURNS a value (and a server/close handle for `dev`/`serve`),
 * and throws `CliError` for the failure paths the binary maps to exit code 1.
 *
 * The thin top-level wrapper below preserves identical binary behavior: it reads
 * `process.argv`, calls `run`, prints `CliError` messages the same way the old
 * inline `failClean`/`console.error` did, and exits with the right code.
 *
 * @typedef {object} RunEnv
 * @property {string} [cwd] Working directory (defaults to `process.cwd()`).
 * @property {(message?: unknown, ...rest: unknown[]) => void} [log] stdout sink.
 * @property {(message?: unknown, ...rest: unknown[]) => void} [warn] stderr (warn) sink.
 * @property {(message?: unknown, ...rest: unknown[]) => void} [error] stderr (error) sink.
 * @property {(file: string, args: string[], options: object) => Promise<{ code: number, stdout: string, stderr: string }>} [spawn] Process runner for `deploy` (defaults to a real spawn); injectable for tests.
 *
 * @param {string[]} argv The argv tail (i.e. `process.argv.slice(2)`).
 * @param {RunEnv} [env]
 * @returns {Promise<{ command: string, server?: import("node:http").Server, close?: () => Promise<void> }>}
 */
export async function run(argv, env = {}) {
  const cwd = env.cwd ?? process.cwd();
  const log = env.log ?? console.log;
  const warn = env.warn ?? console.warn;
  const error = env.error ?? console.error;
  // Bare `darkmown` prints help (discovery) rather than silently building — a new
  // user typing the command alone expects to see what it can do, not a no-op build.
  const command = argv[0] || "help";

  if (command === "help" || command === "--help" || command === "-h") {
    log(helpText());
    return { command: "help" };
  }
  if (command === "version" || command === "--version" || command === "-v") {
    const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    log(pkg.version);
    return { command: "version" };
  }
  if (command === "catalog") {
    // `catalog` prints the machine-readable directive catalog as JSON; `--llms`
    // prints the compact llms.txt cheatsheet an app pastes into a model prompt.
    log(argv.includes("--llms") ? llmsText() : JSON.stringify(directiveCatalog(), null, 2));
    return { command: "catalog" };
  }
  if (command === "init") {
    const target = argv.slice(1).find((arg) => !arg.startsWith("-")) || ".";
    const template = flagValue(argv, "--template");
    const result = initProject(path.resolve(cwd, target), { template });
    const relativeRoot = path.relative(cwd, result.root) || ".";
    log(`Created Darkmown project (${result.template}) at ${relativeRoot}`);
    log(`Next: ${nextStep(relativeRoot)}`);
    return { command: "init" };
  }
  if (command === "build") {
    const target = flagValue(argv, "--target");
    // `--drafts` includes `draft: true` pages in the build + feeds (staging);
    // the default production build excludes them at route discovery.
    const includeDrafts = argv.includes("--drafts");
    // Dev-server plumbing: `--dep-map` writes the per-route dependency map;
    // `--changed <path>` (repeatable, implies --dep-map) attempts an incremental
    // rebuild of just the affected routes, with a full-rebuild fallback on any
    // uncertainty. Not part of the public CLI surface.
    const changed = flagValues(argv, "--changed");
    const depMap = argv.includes("--dep-map") || changed.length > 0;
    // Dev rebuilds pass this so the site_url/placeholder feed hints print once per
    // session (from the initial in-process build) instead of on every rebuild.
    const quietFeedHints = argv.includes("--quiet-feed-hints");
    const result = buildSite(cwd, { target, includeDrafts, changed, depMap, quietFeedHints });
    log(buildSummary(result, path.relative(cwd, result.distRoot)));
    if (target === "cloudflare")
      log("Emitted dist/_worker.js for Cloudflare Pages api/* functions");
    return { command: "build" };
  }
  if (command === "dev") {
    return startDevServer({ cwd, log, warn, error });
  }
  if (command === "serve") {
    return startPreviewServer({ cwd, log, error });
  }
  if (command === "deploy") {
    const target = argv.slice(1).find((arg) => !arg.startsWith("-"));
    if (!target) {
      error(`Usage: darkmown deploy <${DEPLOY_TARGETS.join("|")}> [--prod]`);
      throw new CliError("Missing deploy target", { silent: true });
    }
    await deploy({ cwd, target, prod: argv.includes("--prod"), log, run: env.spawn });
    return { command: "deploy" };
  }
  // No command matched: report it, show help, and fail like the binary always
  // did (exit 1). `silent` keeps `main` from re-printing a `✗` line on top.
  error(`Unknown command: ${command}`);
  log(helpText());
  throw new CliError(`Unknown command: ${command}`, { silent: true });
}

/**
 * An error whose message is already user-facing. The binary prints it (prefixed
 * with `✗` unless `silent`) and exits 1 — never a Node stack trace.
 */
export class CliError extends Error {
  /**
   * @param {string} message
   * @param {{ silent?: boolean }} [options] `silent` skips the `✗`-prefixed print
   *   (used when the message was already shown, e.g. unknown command + help).
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "CliError";
    this.silent = Boolean(options.silent);
  }
}

/**
 * Start the live-compiler dev server. Builds once (recording, not crashing on, a
 * broken initial build), watches `site/` and `src/`, and serves dist with the
 * dev client + SSE reload channel injected. Returns the server and a clean
 * `close()` that tears down the watchers and the rebuild debounce timer.
 * @param {{ cwd: string, log: typeof console.log, warn: typeof console.warn, error: typeof console.error }} io
 * @returns {Promise<{ command: "dev", server: import("node:http").Server, close: () => Promise<void> }>}
 */
function startDevServer({ cwd, log, warn, error }) {
  const port = Number(process.env.PORT || 5173);
  const host = process.env.HOST || "127.0.0.1";
  const distRoot = path.join(cwd, "dist");
  /** @type {Set<import("node:http").ServerResponse>} */
  const clients = new Set();
  /** @type {string | undefined} Last build failure, replayed to clients on connect. */
  let lastBuildError;

  // A broken initial build must NOT crash the process before the HTTP server —
  // and thus the error overlay — comes up. Record the error so new SSE clients
  // see it on connect; the next successful rebuild clears it via `reload`.
  // Dev builds + serves `draft: true` pages (they're work-in-progress you want
  // to preview); the dev client stamps a visible banner so a draft is obvious.
  // `depMap: true` writes the per-route dependency map that lets the rebuilds
  // below be incremental for site/ content changes.
  try {
    buildSite(cwd, { includeDrafts: true, depMap: true });
  } catch (err) {
    lastBuildError = (err instanceof Error ? err.message : String(err)).trim();
    error(`✗ Initial build failed:\n${lastBuildError}`);
  }

  // Rebuild in a child process so changes to Darkmown's own src/ always load
  // fresh modules — an in-process rebuild would reuse the stale import cache.
  // A site/ change additionally passes the changed path(s), so the child can
  // rebuild only the routes whose dependency graph contains them (the builder
  // falls back to a full rebuild on any uncertainty). A src/ change — or an
  // event with no attributable file — queues `null`, forcing the full rebuild.
  // The queue serializes the children: every build read-modify-writes the
  // dependency map, so overlapping children could persist a stale map and
  // silently stop rebuilding affected routes.
  const runBuild = (/** @type {string[]} */ changed) =>
    new Promise((/** @type {(value?: void) => void} */ done) => {
      const args = [cliPath, "build", "--drafts", "--dep-map", "--quiet-feed-hints"];
      for (const file of changed) args.push("--changed", file);
      const started = performance.now();
      execFile(process.execPath, args, { cwd }, (err, stdout, stderr) => {
        if (err) {
          const message = (stderr || stdout || String(err)).trim();
          lastBuildError = message;
          error(message);
          broadcast(
            clients,
            `event: builderror\ndata: ${JSON.stringify({ message: message.slice(0, 4000) })}\n\n`
          );
          done();
          return;
        }
        lastBuildError = undefined;
        const elapsed = Math.round(performance.now() - started);
        if (stderr.trim()) warn(stderr.trim());
        broadcast(clients, `event: reload\ndata: ${JSON.stringify({ elapsed })}\n\n`);
        log(`${stdout.trim().split("\n").at(-1)} (${elapsed}ms)`);
        done();
      });
    });
  const queue = createRebuildQueue(runBuild);

  /** @type {import("node:fs").FSWatcher[]} */
  const watchers = [];
  for (const dir of ["site", "src"]) {
    const abs = path.join(cwd, dir);
    if (fs.existsSync(abs)) {
      watchers.push(
        fs.watch(abs, { recursive: true }, (_event, filename) => {
          queue.change(
            dir === "site" && filename
              ? path.join(dir, filename.toString()).replaceAll(path.sep, "/")
              : null
          );
        })
      );
    }
  }

  const apiDir = path.join(cwd, "api");
  const server = http.createServer((req, res) => {
    const url = req.url || "/";
    if (url.split("?")[0] === devEventsPath) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      res.write("\n");
      clients.add(res);
      // Replay a broken build to clients that connect while it's still failing,
      // so the overlay shows even after a startup or pre-connect compile error.
      if (lastBuildError) {
        res.write(
          `event: builderror\ndata: ${JSON.stringify({ message: lastBuildError.slice(0, 4000) })}\n\n`
        );
      }
      req.on("close", () => clients.delete(res));
      return;
    }
    if (url.split("?")[0] === devClientPath) {
      res.writeHead(200, { "content-type": "text/javascript" });
      res.end(devClientScript());
      return;
    }
    // Serverless parity: run a project `api/*.js` function if the path matches,
    // exactly as Vercel/Cloudflare would in production; otherwise serve static. A
    // throw on either path (e.g. a stat/read error) becomes a clean 500.
    handleApiRequest({ apiDir, req, res })
      .then((handled) => {
        if (!handled) serveDev(distRoot, url, res, draftRoutes(cwd), () => lastBuildError);
      })
      .catch((err) => {
        res.writeHead(500, { "content-type": "text/plain" });
        res.end((err instanceof Error && err.stack) || String(err));
      });
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      // Never claim a clean start over a broken build: when the initial build
      // failed, say so on the ready line and point at the fix-to-retry flow.
      log(
        lastBuildError
          ? `Darkmown dev server ready at http://${host}:${port} — but the initial build FAILED (see the error above). Routes show it until you fix the file; rebuilds run on save.`
          : `Darkmown dev server ready at http://${host}:${port}`
      );
      log(`Live compiler watching site/ and src/`);
      resolve({
        command: "dev",
        server,
        close: () => {
          queue.close();
          for (const watcher of watchers) watcher.close();
          for (const client of clients) client.end();
          clients.clear();
          return new Promise((done) => server.close(() => done()));
        }
      });
    });
  });
}

/**
 * Start the static preview server for an existing `dist/`. Throws `CliError`
 * when there is nothing built to serve.
 * @param {{ cwd: string, log: typeof console.log, error: typeof console.error }} io
 * @returns {Promise<{ command: "serve", server: import("node:http").Server, close: () => Promise<void> }>}
 */
function startPreviewServer({ cwd, log, error }) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || "127.0.0.1";
  const distRoot = path.join(cwd, "dist");
  if (!fs.existsSync(distRoot)) {
    error("No dist directory found. Run `darkmown build` first.");
    throw new CliError("No dist directory found. Run `darkmown build` first.", { silent: true });
  }
  const server = http.createServer((req, res) => serve(distRoot, req.url || "/", res));
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      log(`Darkmown preview of dist at http://${host}:${port}`);
      resolve({
        command: "serve",
        server,
        close: () => new Promise((done) => server.close(() => done()))
      });
    });
  });
}

/**
 * @param {string} distRoot
 * @param {string} url
 * @param {import("node:http").ServerResponse} res
 * @param {Set<string>} draftFiles Absolute dist HTML paths of draft pages — each
 *   gets the dev-only draft banner injected (never written to disk).
 * @param {() => string | undefined} buildError Reads the last recorded build
 *   failure (undefined once a build succeeds).
 * @returns {void}
 */
function serveDev(distRoot, url, res, draftFiles, buildError) {
  const file = resolvePublicFile(distRoot, url);
  if (!file || !fs.existsSync(file)) {
    // An HTML route with no dist output while the last build FAILED is almost
    // certainly unbuilt because of that failure — serve the compile error (the
    // SSE overlay replays it too), not the misleading "hidden or not created"
    // 404. Non-HTML assets and traversal-rejected URLs still 404 normally.
    const failure = buildError();
    if (failure && file?.endsWith(".html")) {
      res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      res.end(buildFailedPage(failure));
      return;
    }
    serve(distRoot, url, res);
    return;
  }
  if (file.endsWith(".html")) {
    // Read BEFORE writing headers: if the read throws (e.g. the path is a
    // directory), the handler's catch can still send a clean 500 instead of
    // failing to overwrite an already-sent 200.
    const html = injectDevClient(fs.readFileSync(file, "utf8"), { draft: draftFiles.has(file) });
    res.writeHead(200, { "content-type": "text/html" });
    res.end(html);
    return;
  }
  res.writeHead(200, { "content-type": contentType(file) });
  fs.createReadStream(file).pipe(res);
}

/**
 * The set of absolute dist HTML paths that correspond to `draft: true` source
 * pages, so the dev server can banner exactly those. Recomputed per HTML request
 * (cheap, and stays correct as a page gains/loses `draft:` during a dev session).
 * Returns an empty set when the project has no `site/pages` yet.
 * @param {string} cwd Project working directory.
 * @returns {Set<string>}
 */
function draftRoutes(cwd) {
  const paths = createPaths(cwd);
  /** @type {Set<string>} */
  const drafts = new Set();
  for (const route of discoverRoutes(paths.routesRoot, { includeDrafts: true })) {
    if (isDraft(route.meta)) drafts.add(outputPathForRoute(paths.distRoot, route.route));
  }
  return drafts;
}

/**
 * @param {Set<import("node:http").ServerResponse>} clients
 * @param {string} message
 * @returns {void}
 */
function broadcast(clients, message) {
  for (const client of clients) client.write(message);
}

/**
 * The CLI help text. Returned (not printed) so `run` and tests share one source.
 * @returns {string}
 */
export function helpText() {
  return `Darkmown

Usage:
  darkmown init [dir] [--template <name>]   Scaffold a new project from a template
  darkmown dev                              Start the live compiler dev server
  darkmown build [--target cloudflare]      Compile site/pages into dist
            [--drafts]                      Include draft: true pages (staging)
  darkmown deploy <${DEPLOY_TARGETS.join("|")}> [--prod]    Build + deploy to a platform
  darkmown serve                            Preview the built dist locally
  darkmown catalog [--llms]                 Print the .wd directive catalog (JSON, or --llms cheatsheet)
  darkmown version                          Print the installed Darkmown version
  darkmown help                             Show this help

Templates (init --template <name>): ${availableTemplates().join(", ")}

Authoring:
  site/pages          File-based routes: .md stays plain, .wd adds directives
  site/_              Include shelf for @include /name.wd
  api/                Serverless functions: export default (request) => Response
  @loop x into item   Loop over JSON files, in-scope values, or :state lists
  *.skin              Colocated indentation-based CSS
  *.js                Colocated page behavior
`;
}

/**
 * The one-line `build` summary: route count plus, when the feeds were emitted
 * (home `site_url` set), the sitemap URL and RSS post counts — e.g.
 * `Built 14 routes, sitemap (14 urls), rss (6 posts) into dist`. When no
 * `site_url` is set the feed clauses are omitted (a hint was already warned).
 * An incremental (dev `--changed`) build reports what it actually rebuilt —
 * `Rebuilt 2 of 14 routes (/blog/, /blog/hello/) into dist` — naming the routes
 * when there are few enough to read.
 * @param {{ routes: unknown[], feeds: { sitemap: number | null, rss: number | null }, incremental?: { rebuilt: string[], total: number } }} result
 * @param {string} relativeRoot `dist` relative to cwd, for the message tail.
 * @returns {string}
 */
export function buildSummary(result, relativeRoot) {
  if (result.incremental) {
    const { rebuilt, total } = result.incremental;
    const shown = rebuilt.length > 0 && rebuilt.length <= 6 ? ` (${rebuilt.join(", ")})` : "";
    return `Rebuilt ${rebuilt.length} of ${total} routes${shown} into ${relativeRoot}`;
  }
  const parts = [`Built ${result.routes.length} routes`];
  if (result.feeds.sitemap !== null) parts.push(`sitemap (${result.feeds.sitemap} urls)`);
  if (result.feeds.rss !== null) parts.push(`rss (${result.feeds.rss} posts)`);
  return `${parts.join(", ")} into ${relativeRoot}`;
}

/**
 * @param {string} relativeRoot
 * @returns {string}
 */
export function nextStep(relativeRoot) {
  if (relativeRoot === ".") return "npm install && npm run dev";
  return `cd ${relativeRoot} && npm install && npm run dev`;
}

/**
 * Read a `--flag value` or `--flag=value` option out of an argv tail.
 * @param {string[]} argv The argv tail.
 * @param {string} flag The flag name, e.g. `"--target"`.
 * @returns {string | undefined} The value, or undefined when the flag is absent.
 */
export function flagValue(argv, flag) {
  const inline = argv.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = argv.indexOf(flag);
  if (index !== -1 && index + 1 < argv.length) return argv[index + 1];
  return undefined;
}

/**
 * Read every occurrence of a repeatable `--flag value` / `--flag=value` option
 * out of an argv tail (e.g. the dev server passing one `--changed <path>` per
 * file in a debounced batch).
 * @param {string[]} argv The argv tail.
 * @param {string} flag The flag name, e.g. `"--changed"`.
 * @returns {string[]} The values, in argv order (empty when the flag is absent).
 */
export function flagValues(argv, flag) {
  /** @type {string[]} */
  const values = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) values.push(argv[++i]);
    else if (argv[i].startsWith(`${flag}=`)) values.push(argv[i].slice(flag.length + 1));
  }
  return values;
}

/**
 * Binary entry point: read argv, dispatch, and map failures to a clean
 * `✗`-prefixed line + exit code 1 — never a Node stack trace. The thrown Error
 * already carries the file path + corrective hint.
 * @returns {Promise<void>}
 */
async function main() {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof CliError && error.silent)) {
      // A compile error has a clear, file-pathed message — print just that.
      console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
    }
    process.exit(1);
  }
}

/**
 * Whether `entryArg` (typically `process.argv[1]`) points at THIS module — i.e.
 * the binary is being executed, not imported by a test. npm installs the
 * `darkmown` bin as a SYMLINK in node_modules/.bin, so the entry arg is the link
 * path while `import.meta.url` resolves to the real file; comparing realpaths
 * lets the binary still self-execute. Exported so the symlink/missing-path
 * branches are unit-testable.
 * @param {string | undefined} entryArg
 * @returns {boolean}
 */
export function isEntryPoint(entryArg) {
  if (!entryArg) return false;
  if (entryArg === cliPath) return true;
  try {
    // Resolve symlinks on BOTH sides: npm's .bin/darkmown is a link to this file.
    return fs.realpathSync(entryArg) === fs.realpathSync(cliPath);
  } catch {
    return false; // a non-existent entry path can never be this module
  }
}

// Auto-run only when this file is the process entry point.
if (isEntryPoint(process.argv[1])) {
  main();
}
