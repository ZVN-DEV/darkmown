export const devClientPath = "/__wd/dev-client.js";
export const devEventsPath = "/__wd/dev-events";

/**
 * Inject the dev-client `<script>` before `</body>` (or append it if absent),
 * plus — for a `draft: true` page — an inline draft-banner script. Both are
 * injected at dev-SERVE time only, so neither ever touches the shipped HTML on
 * disk (a production build excludes drafts entirely; a `build --drafts` staging
 * build emits clean HTML with no banner).
 * @param {string} html Page HTML to augment.
 * @param {{ draft?: boolean }} [options] `draft: true` adds the visible banner.
 * @returns {string}
 */
export function injectDevClient(html, options = {}) {
  const scripts = [`<script type="module" src="${devClientPath}"></script>`];
  if (options.draft) scripts.push(`<script>${draftBannerScript()}</script>`);
  const block = scripts.join("\n");
  return html.includes("</body>")
    ? html.replace("</body>", `${block}\n</body>`)
    : `${html}\n${block}`;
}

/**
 * The inline dev-only draft banner: a fixed bar marking the page as an unpublished
 * draft, so it's unmistakable in `darkmown dev` that this content is excluded from
 * a production build. Inert (`pointer-events:none`) and high-z so it never blocks
 * the page; dev-serve-injected, so it's never in shipped output.
 * @returns {string}
 */
export function draftBannerScript() {
  return `
const banner = document.createElement("div");
banner.id = "__wd-draft-banner";
banner.textContent = "DRAFT — excluded from production build";
banner.style.cssText = [
  "position:fixed", "top:0", "left:0", "right:0", "z-index:99998",
  "background:#b4541b", "color:#fff8f0", "text-align:center",
  "font:600 12px/2.2 ui-monospace,SFMono-Regular,Menlo,monospace",
  "letter-spacing:.08em", "pointer-events:none"
].join(";");
document.addEventListener("DOMContentLoaded", () => document.body.prepend(banner));
`;
}

/**
 * The dev-client browser script that opens the SSE channel for live reload.
 * @returns {string}
 */
export function devClientScript() {
  return `
const source = new EventSource("${devEventsPath}");
source.addEventListener("reload", () => location.reload());
source.addEventListener("builderror", (event) => {
  const { message } = JSON.parse(event.data);
  let overlay = document.getElementById("__wd-error-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "__wd-error-overlay";
    overlay.style.cssText = [
      "position:fixed", "inset:0", "z-index:99999", "background:rgba(24,18,16,.96)",
      "color:#ffd9cf", "font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace",
      "padding:3rem 2rem", "white-space:pre-wrap", "overflow:auto"
    ].join(";");
    document.body.appendChild(overlay);
  }
  overlay.textContent = "Darkmown build failed\\n\\n" + message + "\\n\\nFix the file and this overlay clears on the next successful build.";
});
source.addEventListener("error", () => {});
`;
}
