// Regenerate the social-share cards under site/_/ (1200×630), served at
// /__wd/media/. Each card is rendered from an HTML template via headless
// Chromium (Playwright is already a devDependency) and screenshotted — so the
// images are reproducible source, not hand-edited binaries. Run `npm run og`
// after any copy or branding change.
//
// One brand card (og.png) plus one per showcase surface, each tinted to that
// app's identity accent. All are excluded from the npm tarball (see the
// package.json `files` "!site/_/og*.png" rule) — they ship with the site only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const shelf = path.join(here, "..", "site", "_");

// The flagship brand card keeps its original wording and palette.
const brand = `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: linear-gradient(140deg, #1d2b23 0%, #15201a 60%, #121814 100%);
    color: #f5f1e8; font-family: Georgia, "Times New Roman", serif;
    padding: 80px 88px; display: flex; flex-direction: column; justify-content: space-between;
  }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .badge { width: 96px; height: 96px; border-radius: 22px; background: #f5f1e8; color: #16201a;
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 60px; line-height: 1; }
  .domain { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 30px; color: #8ea89a; letter-spacing: -0.5px; }
  .headline { font-weight: 700; font-size: 90px; line-height: 1.05; letter-spacing: -1.5px; max-width: 1020px; }
  .accent { color: #93ab9c; }
  .footer { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 30px; color: #8b9b91; letter-spacing: -0.5px; line-height: 1.5; }
  .dot { color: #5d6f64; padding: 0 14px; }
</style></head><body>
  <div class="top"><div class="badge">D</div><div class="domain">darkmown.com</div></div>
  <div class="headline">Markdown that <span class="accent">runs</span>.<br>Not Markdown that needs React.</div>
  <div class="footer">.md stays plain <span class="dot">·</span> .wd adds loops, state &amp; fetch <span class="dot">·</span> under 6 KB runtime</div>
</body></html>`;

// Per-app cards share one layout, parameterized by identity accent + copy.
const app = ({
  accent,
  glow,
  emoji,
  name,
  tagline,
  code
}) => `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background:
      radial-gradient(900px 520px at 85% -10%, ${glow} 0%, transparent 60%),
      linear-gradient(140deg, #181410 0%, #14110d 60%, #100d0a 100%);
    color: #f6f1e8; font-family: Georgia, "Times New Roman", serif;
    padding: 78px 88px; display: flex; flex-direction: column; justify-content: space-between;
  }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .brand { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 28px; color: #b9ab97; letter-spacing: -0.5px; }
  .brand b { color: ${accent}; }
  .pill { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 24px; color: ${accent};
    border: 1px solid ${accent}; border-radius: 999px; padding: 8px 20px; opacity: .9; }
  .emoji { font-size: 86px; line-height: 1; margin-bottom: 14px; }
  .name { font-weight: 700; font-size: 104px; line-height: 1; letter-spacing: -2px; color: ${accent}; }
  .tagline { font-size: 40px; line-height: 1.25; color: #efe7da; max-width: 980px; margin-top: 22px; }
  .footer { font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 27px; color: #9c8f7c; letter-spacing: -0.5px; }
  .footer b { color: #c9bca7; }
</style></head><body>
  <div class="top"><div class="brand"><b>Darkmown</b> showcase</div><div class="pill">darkmown.com</div></div>
  <div><div class="emoji">${emoji}</div><div class="name">${name}</div><div class="tagline">${tagline}</div></div>
  <div class="footer">${code}</div>
</body></html>`;

const cards = [
  { file: "og.png", html: brand },
  {
    file: "og-showcase.png",
    html: app({
      accent: "#7fd8c4",
      glow: "rgba(15,107,94,.5)",
      emoji: "✦",
      name: "Showcase",
      tagline:
        "Four complete apps — a storefront, a dashboard, a configurator, a quiz. Each one a readable Markdown file.",
      code: "Real apps. Written in Markdown."
    })
  },
  {
    file: "og-folio.png",
    html: app({
      accent: "#e88a6f",
      glow: "rgba(184,70,46,.45)",
      emoji: "🛍️",
      name: "Folio",
      tagline: "A storefront whose cart follows you across pages, reloads, and browser tabs.",
      code: ":store cart = []  ·  persists, syncs across tabs, zero backend"
    })
  },
  {
    file: "og-pulse.png",
    html: app({
      accent: "#2fe0c0",
      glow: "rgba(24,184,154,.45)",
      emoji: "📈",
      name: "Pulse",
      tagline:
        "A live status dashboard — fetch, loading & error states, refresh — without a line of JavaScript.",
      code: ':fetch board from "/data.json"  ·  loading · error · empty · refetch'
    })
  },
  {
    file: "og-forge.png",
    html: app({
      accent: "#9b8bff",
      glow: "rgba(109,90,230,.45)",
      emoji: "🧩",
      name: "Forge",
      tagline: "Build your plan. The price recomputes the instant you toggle a feature.",
      code: ":computed total = base + seats*8 + analytics*25"
    })
  },
  {
    file: "og-compass.png",
    html: app({
      accent: "#f0a868",
      glow: "rgba(224,137,74,.45)",
      emoji: "🧭",
      name: "Compass",
      tagline: "A product-finder quiz — a branching state machine expressed entirely as :if steps.",
      code: ":if step == 1 … :else if step == 2 …"
    })
  }
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 1
});
for (const card of cards) {
  await page.setContent(card.html, { waitUntil: "load" });
  const out = path.join(shelf, card.file);
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`Wrote ${out}`);
}
await browser.close();
fs.accessSync(path.join(shelf, "og.png"));
