# Darkmown CLI

## Install locally

```sh
npm install
npm link
darkmown help
```

`package.json` exposes the executable as `darkmown`.

## Commands

### `darkmown init [dir]`

Creates a minimal Darkmown site with:

- `package.json` (pins the current `@zvndev/darkmown` version)
- `site/pages/index.wd`
- `site/pages/index.skin`
- `site/pages/about.md`
- `site/_/nav.wd`
- `README.md`

Existing files are not overwritten.

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

### `darkmown build`

Compiles `site/pages` into `dist`.

Static pages do not receive `/__wd/runtime.js`; reactive pages do.

When a `.md` file contains `.wd` syntax (directives, includes, loops), the build prints a hint suggesting a rename to `.wd` — the syntax stays plain text in `.md` by design.