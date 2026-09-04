# My Darkmown site

Run `npm install` and `npm run dev` to start the live compiler.

## Commands

- `npm run dev` — live compiler on http://localhost:5173 with hot reload.
- `npm run build` — compile the site to `dist/`.
- `npm run preview` — serve the built `dist/` locally.

## Deploy

One command (it builds, then prints your live URL — log in if prompted):

```sh
npx darkmown deploy vercel       # or: npx darkmown deploy cloudflare
```

Or one-click, after pushing this repo to GitHub (replace `YOUR_REPO_URL` in both links with your repository URL):

[![Deploy to Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=YOUR_REPO_URL)
&nbsp;
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=YOUR_REPO_URL)

## Layout

- Pages live in `site/pages` — `.md` stays plain Markdown, `.wd` adds directives.
- Shared includes live in `site/_`.
- Backend functions live in `api/` — plain Web-standard `(request) => Response`.
  They run in `darkmown dev` and on Vercel/Cloudflare with no extra config.
- Hidden route files start with `.` or `-`.
- Colocated `index.skin` and `index.js` attach to a page automatically.
