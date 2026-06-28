# Dashboard — a Darkmown template

A live dashboard. The page is static; the stat cards `:fetch` their data from
`api/metrics.js` — a plain Web-standard `(request) => Response` function that runs
in `darkmown dev` and on every host. Loading and error states are handled inline.

- **Data** — `api/metrics.js`. Replace its body with a real query (DB, analytics,
  billing). Add more endpoints as `api/<name>.js`; each maps to `/api/<name>`.
- **View** — `site/pages/index.wd` fetches `/api/metrics` and renders stat cards.

## Commands

- `npm run dev` — live compiler + local `/api/*` runner on http://localhost:5173.
- `npm run build` — compile to `dist/`.
- `npm run preview` — serve the built `dist/` locally (static only; use `dev` for `/api`).

## Deploy

```sh
npx darkmown deploy vercel       # or: npx darkmown deploy cloudflare
```

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)
&nbsp;
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=YOUR_REPO_URL)
