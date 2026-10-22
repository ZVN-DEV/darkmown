# Darkmown CLI

The published package is `@zvndev/darkmown`; the executable it installs is plain `darkmown`. Nothing here needs a global install.

## Install

Scaffold a new project in one command, with no prior install:

```sh
npx @zvndev/darkmown init my-site
cd my-site
npm install
npm run dev
```

Or add it to a project you already have, and call it through `npx`:

```sh
npm install -D @zvndev/darkmown
npx darkmown help
```

Working on the framework itself instead? See [Contributing](../CONTRIBUTING.md). From a clone, `npm install` then `npm link` puts a `darkmown` on your `PATH` that points at your working tree.

## Commands

### `darkmown help` / `darkmown --help`

Prints the command summary, authoring directories, and common directive syntax.

### `darkmown version` / `darkmown --version`

Prints the installed package version.

### `darkmown init [dir] [--template <name>]`

Scaffolds a Darkmown site from a template (default: `starter`). Available templates:

- **`starter`** — the minimal counter + todo-loop site.
- **`blog`** — markdown posts as a typed content collection: `site/pages/posts/` holds the `.md` posts, a `_schema.wd` type-checks each one's frontmatter at build time, and the `.wd` index is one `@loop posts into post sort by post.date desc` over the folder. Adding a post is dropping a `.md` file — no manifest to maintain.
- **`store`** — product grid, a shared `:store` cart, and a checkout that posts to `api/checkout.js`.
- **`dashboard`** — stat cards that `:fetch` from `api/metrics.js`.
- **`landing`** — a marketing one-pager with a `:carousel`.

```sh
darkmown init my-site --template store
```

Every scaffold also writes agent context at the project root: `AGENTS.md` (the full directive reference, copied byte-for-byte from the installed package so it can never teach different syntax than the compiler accepts), a short `CLAUDE.md` pointing at it, and a `.gitignore` covering `node_modules/` and `dist/`. Coding agents read instruction files from the project root, so without this a new project starts every session with the agent guessing at directive syntax.

Existing files are never overwritten. The generated `package.json` is private, sets `"type": "module"` (so `api/*.js` import as ESM), includes `dev`/`build`/`preview` scripts, and names the app after the target directory.

After scaffolding:

```sh
cd my-site
npm install
npm run dev
```

### `darkmown dev`

Runs a live compiler:

- builds once at startup
- watches `site/` and `src/`
- debounces rebuilds
- serves cached `dist`
- injects `/__wd/dev-client.js`
- reloads the browser through `/__wd/dev-events`

Rebuilds are **incremental** for `site/` content changes. Every dev build writes a per-route dependency map to `dist/.wd-dev-deps.json` — the route's source file, every resolved `@include`, colocated `.skin`/`.js` assets, `@loop` JSON data files, and the collections it loops. A change then rebuilds only the routes whose dependency graph contains the changed file (a collection entry or its `_schema.wd` also rebuilds the collection's listing and paginated pages), and `routes.json`, `_headers`, and the sitemap/rss feeds are re-emitted globally every time so partial rebuilds stay whole-site consistent. The log reports what happened: `Rebuilt 2 of 29 routes (/blog/, /blog/hello/) into dist`.

Correctness beats speed: **any uncertainty runs a full rebuild** — a new, deleted, or renamed file; a file no dependency graph accounts for; a change to the site-wide feed link; a missing or stale map. A change under `src/` (the framework's own code) always runs a full rebuild in a child process so fresh modules load. Production `darkmown build` writes no map and is unaffected.

Both `dev` and `serve` read three environment variables:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `5173` (dev), `4173` (serve) | Port to listen on. |
| `HOST` | `127.0.0.1` | Address to bind. `0.0.0.0` exposes the server to your network. |
| `DARKMOWN_ALLOWED_HOSTS` | empty | Extra `Host` names to accept, comma-separated, such as a tunnel domain. `*` disables the check. |

Requests whose `Host` is not `localhost`, `*.localhost`, an IP literal, the bind address, or listed in `DARKMOWN_ALLOWED_HOSTS` get a `403`. This stops DNS rebinding, where a website you visit points its own domain at `127.0.0.1` to read your dev server. Requests to `/api/*` also get a `403` when they are cross-site (`Sec-Fetch-Site: cross-site`, or an `Origin` that is not local or allow-listed).

### `darkmown build [--target cloudflare] [--drafts]`

Compiles `site/pages` into `dist`. The output is always 100% static HTML.

`--drafts` includes pages marked `draft: true` in their frontmatter, which a default `build` leaves out of `dist`, `routes.json`, `sitemap.xml`, and `rss.xml` entirely. Use it for a staging deploy. `darkmown dev` always builds drafts, with a "DRAFT" banner that exists only in the dev server.

Static pages do not receive `/__wd/runtime.js`; reactive pages do. Pay-for-what-you-use behavior modules (`sortable`, `:carousel`) emit to `dist/__wd/behaviors/` only on the pages that use them.

`--target cloudflare` additionally emits `dist/_worker.js` — a Cloudflare Pages worker that routes `/api/*` to the project's `api/*.js` functions and serves everything else from `env.ASSETS`. The default target leaves `api/` for Vercel to run natively. `darkmown deploy` sets the right target automatically.

When a `.md` file contains `.wd` syntax (directives, includes, loops), the build prints a hint suggesting a rename to `.wd` — the syntax stays plain text in `.md` by design.

### `darkmown validate [path]`

Compile-checks pages against the real compiler without writing `dist`. With no argument it checks every route under `site/pages/`, drafts included (a broken draft breaks `darkmown dev`, so it counts). A file argument checks one page or shelf include; a directory argument checks one subtree.

Each page prints one line in the same vocabulary as the `validate` tool: `compiles. static (ships zero JavaScript), 1 skin.` for a clean page, `compiles with N warnings.` with a bullet per warning when the compiler has something non-fatal to say, or the coded `WD` error with its file, line, corrective `use:` template, and a concrete `e.g.` line. Includes, colocated `.skin` files, `@loop` JSON data, and collection `_schema.wd` files are resolved exactly the way the build resolves them, so a page that validates is a page that builds.

The exit code is 0 when everything compiles and 1 when any page fails, so it gates CI:

```sh
darkmown validate && darkmown build
```

### `darkmown deploy <vercel|cloudflare> [--prod]`

Builds (target-aware) and deploys to the platform by wrapping its CLI:

- **`vercel`** — writes a `vercel.json` if absent, then runs `npx vercel deploy` (`--prod` to promote). `api/` functions run natively as Edge Functions.
- **`cloudflare`** — builds the `dist/_worker.js`, then runs `npx wrangler pages deploy dist --project-name <name>`.

The deploy URL is printed when the CLI reports it. If the platform CLI isn't signed in, the command surfaces the login to run (`npx vercel login` / `npx wrangler login`) — in a Claude Code session you can run it inline with the `!` prefix — then re-run the deploy.

### `darkmown serve`

Serves the already-built `dist` directory for local preview. Run `darkmown build` first.

Since 2.8 the preview is at parity with dev for two things:

- **`api/` functions run.** A request to `/api/*` that matches a handler under the project's top-level `api/` directory executes it (same contract and file routing as `darkmown dev` and the production hosts: `api/echo.js` → `/api/echo`, `api/users/[id].js` → `/api/users/:id`); anything else falls through to static serving. `:form action="/api/…"` posts and `:fetch … from "/api/…"` demos that worked in dev now work in the preview too, and editing a handler is picked up without a restart. A project with no `api/` directory behaves exactly as before. Since 2.10.1 the local runner matches production hygiene: request bodies are capped at 10 MB (`413` over cap), a malformed percent-encoded dynamic segment answers `400`, and under `serve` a throwing handler answers the generic `{"ok": false, "error": "Internal error"}` while the real error is logged server-side only. `darkmown dev` keeps the verbose message, because in dev the developer is the audience.
- **Text responses are compressed.** The server negotiates off the request's `Accept-Encoding` (brotli preferred, then gzip, q-values honored) and sets `Vary: Accept-Encoding`, appending to an existing `Vary` rather than clobbering it. Compressible: `text/*`, `application/javascript`, `application/json`, `application/xml`, and `image/svg+xml`, across static files, the built 404 page, and `api/` responses (a handler that set its own `Content-Encoding` is never double-compressed). Images, video, audio, and fonts are never compressed. `darkmown dev` is intentionally uncompressed, byte-identical to 2.7.
- **Static responses carry cache validators.** Every static 200 (and the built 404) sends `Last-Modified` and a strong `ETag`; `If-None-Match` (comma-lists and `*` honored) and `If-Modified-Since` are answered with a 304 carrying the validators and no body, with `If-None-Match` taking precedence per RFC 7232. Cache-Control by file class: HTML gets `no-cache` (always revalidate, but revalidations are cheap 304s), anything under `/__wd/` and media/font extensions anywhere get `public, max-age=3600` (unchanged between builds, and any rebuild moves the validators), and everything else stays deliberately unopinionated at `no-cache`. The freshness check runs before compression work, and `api/` responses are untouched. Reloads therefore revalidate instead of re-downloading every asset. `darkmown dev` sends none of this, by design.

### `darkmown catalog [--llms|--llms-full]`

Prints the machine-readable `.wd` directive catalog as JSON: every directive, `@loop` clause, loop variable, button action, format pipe, and predicate operator, each with a syntax template, description, and concrete example.

- `--llms` prints a compact markdown cheatsheet instead: the artifact to paste into an AI model's system prompt.
- `--llms-full` prints the complete reference that cheatsheet points at: every directive with its full syntax and example, every clause, action, pipe, operator, and frontmatter key, plus **every compile-error code with its cause and fix**. An edit loop that hits `[WD201]` can resolve it from the same output it learned the syntax from.

```sh
darkmown catalog --llms > system-prompt.md
darkmown catalog --llms-full > reference.md
```

Every `darkmown build` also writes both files (`dist/llms.txt` and `dist/llms-full.txt`), and Darkmown ships a generated GBNF grammar (`grammar/wd-directives.gbnf`) for constrained decoding.

### `darkmown mcp`

Runs a Model Context Protocol server on stdio, so an MCP-capable agent gets the language description and the compiler as first-class tools. It is hand-rolled with zero dependencies: MCP over stdio is newline-delimited JSON-RPC 2.0 (protocol revision 2024-11-05), stdout carries protocol frames only, and logs go to stderr. Every tool is a thin adapter over the same drift-guarded surfaces the CLI uses, so a client and the CLI can never disagree.

Five tools: `catalog` (the directive catalog as `json`, `llms`, or `llms-full`), `grammar` (the full GBNF grammar, or a category slice of the cheatsheet), `validate` (compile `.wd`/`.md` source in memory: static/reactive status and warnings on success, the WD code with file:line, `Use:` hint, and example on failure), `error` (one WD code's cause, fix, and example, or the valid list), and `doc` (fuzzy section search over the shipped README and AGENTS.md). Five resources expose the shipped docs at `darkmown://docs/readme`, `darkmown://docs/agents`, `darkmown://docs/changelog`, `darkmown://docs/errors`, and `darkmown://docs/cli`, read from the installed package at request time. Prompts, logging, completion, sampling, subscriptions, and batched requests are deliberately not implemented.

Client config (Claude Code, Cursor, and friends share this shape):

```json
{
  "mcpServers": {
    "darkmown": {
      "command": "npx",
      "args": ["-y", "@zvndev/darkmown", "mcp"]
    }
  }
}
```

## Backends (`api/`)

Backend endpoints are plain-JS Web-standard handlers in a top-level `api/` directory — the same shape on every host, and the only thing you write for a server:

```js
// api/subscribe.js  →  /api/subscribe
export const config = { runtime: "edge" }; // Vercel: run as an Edge Function

export default async function (request, context) {
  const { email } = await request.json();
  return Response.json({ ok: true, email });
}
```

`api/users/[id].js` maps to `/api/users/:id` (`context.params.id`). These run in `darkmown dev` and in `darkmown serve` (same local runner), on **Vercel** natively, and on **Cloudflare Pages** via the `dist/_worker.js` that `darkmown deploy cloudflare` emits. `:fetch`/`:form` point at `/api/*` with no extra config. Need a Node-only API on Vercel? Drop `export const config` and use `(req, res)`, noting that local-dev parity is then lost for that function.

**Custom server / remote backend.** Point `:fetch`/`:form` at an absolute URL (`https://api.example.com/…`) and widen the CSP `connect-src` (and `form-action` for native form POSTs) in `vercel.json` / `dist/_headers` / your serve config. Darkmown still ships static; only the requests leave your origin.

### Cloudflare Pages note

Cloudflare advanced mode (`dist/_worker.js`) does not run a bundler, so an `api/` handler deployed to Cloudflare must be dependency-free (or pre-bundled). The same source still runs on Vercel (which bundles) and in `darkmown dev`.

## Working on the framework itself

Everything from here down is for a clone of the Darkmown repository, not for a project built with it.

### Regenerating the runtime artifact

The runtime that ships is `src/runtime.min.js`, a committed esbuild build of the readable `src/runtime.js` (plus its sourcemap). `darkmown build` copies that artifact byte for byte, so it has to be regenerated whenever the source changes:

```sh
npm run build:runtime
```

Nothing regenerates it behind your back. A drift test rebuilds it in memory and fails on any byte difference, and CI runs the same check, so a stale artifact fails the build rather than shipping. `npm run dev` regenerates it first through `predev`, which is why development and production serve the same bytes.

### Smoke checks

From this repository, run:

```sh
npm run smoke
```

The smoke script packs the local tarball, installs the packed CLI in a temporary driver project, scaffolds a consumer app through that installed bin, installs the same tarball into the app, builds it, verifies the reactive home route, and verifies the plain `.md` about route stays zero-JS.
