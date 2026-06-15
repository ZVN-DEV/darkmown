export const devClientPath = "/__wd/dev-client.js";
export const devEventsPath = "/__wd/dev-events";

/**
 * Inject the dev-client `<script>` before `</body>` (or append it if absent).
 * @param {string} html Page HTML to augment.
 * @returns {string}
 */
export function injectDevClient(html) {
  const script = `<script type="module" src="${devClientPath}"></script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}\n</body>`) : `${html}\n${script}`;
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
