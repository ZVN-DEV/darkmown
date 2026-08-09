# Darkmown CLI

## Install locally

```sh
npm install
npm link
darkmown help
```

`package.json` exposes the executable as `darkmown`.

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

### `darkmown build [--target cloudflare]`

Compiles `site/pages` into `dist`. The output is always 100% static HTML.

Static pages do not receive `/__wd/runtime.js`; reactive pages do. Pay-for-what-you-use behavior modules (`:sortable`, `:carousel`) emit to `dist/__wd/behaviors/` only on the pages that use them.

`--target cloudflare` additionally emits `dist/_worker.js` — a Cloudflare Pages worker that routes `/api/*` to the project's `api/*.js` functions and serves everything else from `env.ASSETS`. The default target leaves `api/` for Vercel to run natively. `darkmown deploy` sets the right target automatically.

When a `.md` file contains `.wd` syntax (directives, includes, loops), the build prints a hint suggesting a rename to `.wd` — the syntax stays plain text in `.md` by design.

### `darkmown deploy <vercel|cloudflare> [--prod]`

Builds (target-aware) and deploys to the platform by wrapping its CLI:

- **`vercel`** — writes a `vercel.json` if absent, then runs `npx vercel deploy` (`--prod` to promote). `api/` functions run natively as Edge Functions.
- **`cloudflare`** — builds the `dist/_worker.js`, then runs `npx wrangler pages deploy dist --project-name <name>`.

The deploy URL is printed when the CLI reports it. If the platform CLI isn't signed in, the command surfaces the login to run (`npx vercel login` / `npx wrangler login`) — in a Claude Code session you can run it inline with the `!` prefix — then re-run the deploy.

### `darkmown serve`

Serves the already-built `dist` directory for local preview (static only — use `darkmown dev` to exercise `api/*` locally). Run `darkmown build` first.

### `darkmown catalog [--llms]`

Prints the machine-readable `.wd` directive catalog as JSON — every directive, `@loop` clause, loop variable, button action, format pipe, and predicate operator, each with a syntax template, description, and concrete example. With `--llms` it prints a compact (~90-line) markdown cheatsheet instead — the artifact to paste into an AI model's system prompt. Every `darkmown build` also writes the cheatsheet to `dist/llms.txt`, and Darkmown ships a generated GBNF grammar (`grammar/wd-directives.gbnf`) for constrained decoding.

```sh
darkmown catalog --llms > system-prompt.md
```

## Smoke checks

From this repository, run:

```sh
npm run smoke
```

The smoke script packs the local tarball, installs the packed CLI in a temporary driver project, scaffolds a consumer app through that installed bin, installs the same tarball into the app, builds it, verifies the reactive home route, and verifies the plain `.md` about route stays zero-JS.

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

`api/users/[id].js` maps to `/api/users/:id` (`context.params.id`). These run in `darkmown dev` (local runner), on **Vercel** natively, and on **Cloudflare Pages** via the `dist/_worker.js` that `darkmown deploy cloudflare` emits. `:fetch`/`:form` point at `/api/*` with no extra config. Need a Node-only API on Vercel? Drop `export const config` and use `(req, res)` — note local-dev parity is then lost for that function.

**Custom server / remote backend.** Point `:fetch`/`:form` at an absolute URL (`https://api.example.com/…`) and widen the CSP `connect-src` (and `form-action` for native form POSTs) in `vercel.json` / `dist/_headers` / your serve config. Darkmown still ships static; only the requests leave your origin.

### Cloudflare Pages note

Cloudflare advanced mode (`dist/_worker.js`) does not run a bundler, so an `api/` handler deployed to Cloudflare must be dependency-free (or pre-bundled). The same source still runs on Vercel (which bundles) and in `darkmown dev`.
