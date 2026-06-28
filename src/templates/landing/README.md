# Landing — a Darkmown template

A marketing one-pager: a hero, a feature grid, and a testimonials **carousel**.
The static parts ship zero framework JavaScript; only the carousel loads a tiny,
pay-for-what-you-use behavior module (`/__wd/behaviors/carousel.js`).

- **Carousel** — the `:carousel … :endcarousel` block; native CSS scroll-snap +
  the behavior add prev/next, dots, and mouse drag. Touch swipe is native.
- **Everything else** — plain Markdown + `:::` containers, no JavaScript.

## Commands

- `npm run dev` — live compiler on http://localhost:5173.
- `npm run build` — compile to `dist/`.
- `npm run preview` — serve the built `dist/` locally.

## Deploy

```sh
npx darkmown deploy vercel       # or: npx darkmown deploy cloudflare
```

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)
&nbsp;
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=YOUR_REPO_URL)
