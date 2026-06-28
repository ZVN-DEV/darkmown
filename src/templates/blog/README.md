# Blog — a Darkmown template

A markdown-native blog. Posts are plain `.md` files in `site/pages/posts/`; the
home page loops `site/_/posts.json` to list them. Static pages, zero JavaScript.

## Add a post

1. Create `site/pages/posts/<slug>.md` with a `title` in frontmatter.
2. Add an entry to `site/_/posts.json` (`slug`, `url`, `title`, `date`, `excerpt`).

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
