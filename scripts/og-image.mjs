// Regenerate the social-share card at site/_/og.png (1200×630).
//
// The card is rendered from the HTML template below via headless Chromium
// (Playwright is already a devDependency) and screenshotted — so the image is
// reproducible source, not a hand-edited binary. Run `npm run og` after any
// copy change. The runtime-size line says "under 6 KB" (the CI-enforced budget)
// rather than a precise number, so it can't drift out of date the way the old
// baked "~4.7 KB" did.
import { chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "site", "_", "og.png");

const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: linear-gradient(140deg, #1d2b23 0%, #15201a 60%, #121814 100%);
    color: #f5f1e8;
    font-family: Georgia, "Times New Roman", serif;
    padding: 80px 88px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .top { display: flex; align-items: center; justify-content: space-between; }
  .badge {
    width: 96px; height: 96px;
    border-radius: 22px;
    background: #f5f1e8;
    color: #16201a;
    display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 60px; line-height: 1;
  }
  .domain {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 30px; color: #8ea89a; letter-spacing: -0.5px;
  }
  .headline {
    font-weight: 700; font-size: 90px; line-height: 1.05;
    letter-spacing: -1.5px; max-width: 1020px;
  }
  .accent { color: #93ab9c; }
  .footer {
    font-family: "SF Mono", Menlo, Consolas, monospace;
    font-size: 30px; color: #8b9b91; letter-spacing: -0.5px; line-height: 1.5;
  }
  .dot { color: #5d6f64; padding: 0 14px; }
</style>
</head>
<body>
  <div class="top">
    <div class="badge">D</div>
    <div class="domain">darkmown.com</div>
  </div>
  <div class="headline">Markdown that <span class="accent">runs</span>.<br>Not Markdown that needs React.</div>
  <div class="footer">.md stays plain <span class="dot">·</span> .wd adds loops, state &amp; fetch <span class="dot">·</span> under 6 KB runtime</div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
await browser.close();
console.log(`Wrote ${out}`);
