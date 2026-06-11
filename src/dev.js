export const devClientPath = "/__wd/dev-client.js";
export const devEventsPath = "/__wd/dev-events";

export function injectDevClient(html) {
  const script = `<script type="module" src="${devClientPath}"></script>`;
  return html.includes("</body>") ? html.replace("</body>", `${script}\n</body>`) : `${html}\n${script}`;
}

export function devClientScript() {
  return `
const source = new EventSource("${devEventsPath}");
source.addEventListener("reload", () => location.reload());
source.addEventListener("error", () => {});
`;
}
