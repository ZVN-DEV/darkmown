# Blog — a Darkmown template

A markdown-native blog. Posts are plain `.md` files in `site/pages/posts/` —
that folder is a typed content collection, and the home page is one `@loop`
over it. No manifest, no config. Static pages, zero JavaScript.

## Add a post

1. Create `site/pages/posts/<slug>.md` with `title`, `date`, and `description`
   in frontmatter (`excerpt` is optional). That's it — the home page lists it
   automatically, newest first, and dated posts land in `rss.xml`.
2. Optional: copy an existing post's `.skin` beside the new file — a colocated
   `.skin` attaches automatically, keeping the reading design.

`site/pages/posts/_schema.wd` type-checks every post's frontmatter at build
time, so a typo'd or missing field fails the build with a file and line. When
the list grows, add `paginate 10` to the loop in `site/pages/index.wd` to split
it into `/page/2/`, `/page/3/`, … automatically.

## Commands

- `npm run dev` — live compiler on http://localhost:5173.
- `npm run build` — compile to `dist/`.
- `npm run preview` — serve the built `dist/` locally.

## Deploy

```sh
npx darkmown deploy vercel       # or: npx darkmown deploy cloudflare
```

Or one-click, after pushing this repo to GitHub (replace `YOUR_REPO_URL` in both links with your repository URL):

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)
&nbsp;
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=YOUR_REPO_URL)
