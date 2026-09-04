# Store — a Darkmown template

A storefront in Markdown: a product grid with live search, a shared `:store` cart,
and a checkout that POSTs to a serverless function.

- **Static catalog** — `site/pages/index.wd` loops `site/_/products.json`.
- **Cart** — a `:store` shared across the page; add/remove with `:button`.
- **Checkout** — `:form action="/api/checkout"` posts to `api/checkout.js`, a plain
  Web-standard `(request) => Response` function that runs in `darkmown dev` and on
  every host. Replace its body with your real payment + fulfilment logic.

## Commands

- `npm run dev` — live compiler + the local `/api/*` runner on http://localhost:5173.
- `npm run build` — compile to `dist/`.
- `npm run preview` — serve the built `dist/` locally (static only; use `dev` for `/api`).

## Deploy

```sh
npx darkmown deploy vercel       # or: npx darkmown deploy cloudflare
```

Your `api/checkout.js` deploys automatically alongside the static site.

Or one-click, after pushing this repo to GitHub (replace `YOUR_REPO_URL` in both links with your repository URL):

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)
&nbsp;
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=YOUR_REPO_URL)
