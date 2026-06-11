# Markie CLI

## Install locally

```sh
npm install
npm link
markie help
```

`package.json` exposes the executable as `markie`.

## Commands

### `markie init [dir]`

Creates a minimal Markie site with:

- `site/pages/index.wd`
- `site/pages/index.skin`
- `site/_/nav.wd`
- `README.md`

Existing files are not overwritten.

After scaffolding:

```sh
cd my-site
npm install
npm run dev
```

### `markie dev`

Runs a live compiler:

- builds once at startup
- watches `site/` and `src/`
- debounces rebuilds
- serves cached `dist`
- injects `/__wd/dev-client.js`
- reloads the browser through `/__wd/dev-events`

### `markie build`

Compiles `site/pages` into `dist`.

Static pages do not receive `/__wd/runtime.js`; reactive pages do.

When a `.md` file contains `.wd` syntax (directives, includes, loops), the build prints a hint suggesting a rename to `.wd` — the syntax stays plain text in `.md` by design.
