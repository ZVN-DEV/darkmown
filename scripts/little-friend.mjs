// Add Little Friend analytics to the built darkmown.com site. Runs after
// `npm run build` on Vercel (see vercel.json `buildCommand`) and only changes
// production builds, so previews, local builds and the framework's own output
// never carry the tag.
//
// The tags go before `</head>` of every page in dist/. The CSP in vercel.json
// allows https://cdn.littlefriend.io (scripts) and https://in.littlefriend.io
// (connect). little-friend.browser.js ships as /little-friend.js and sends the
// site's named events.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE_KEY = "lf_W48y0f1SPw3iKiK6h23czSvv";

const TAGS = [
  `<script defer src="https://cdn.littlefriend.io/lf.js" data-site="${SITE_KEY}" data-mode="journey"></script>`,
  `<script defer src="https://cdn.littlefriend.io/lf-replay.js" data-site="${SITE_KEY}"></script>`,
  `<script defer src="/little-friend.js"></script>`
].join("\n  ");

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "..", "dist");

if (process.env.VERCEL_ENV !== "production") {
  console.log("little-friend: not a production build, analytics left out");
  process.exit(0);
}

/**
 * Every `.html` file under a directory.
 * @param {string} dir
 * @returns {string[]}
 */
function htmlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.name.endsWith(".html") ? [full] : [];
  });
}

let tagged = 0;
for (const file of htmlFiles(dist)) {
  const html = fs.readFileSync(file, "utf8");
  if (html.includes(SITE_KEY) || !html.includes("</head>")) continue;
  fs.writeFileSync(file, html.replace("</head>", `  ${TAGS}\n</head>`));
  tagged++;
}

fs.copyFileSync(path.join(here, "little-friend.browser.js"), path.join(dist, "little-friend.js"));

if (tagged === 0) {
  console.error("little-friend: no page in dist/ took the tag");
  process.exit(1);
}
console.log(`little-friend: tagged ${tagged} pages`);
