/**
 * Inject the dev-client `<script>` before `</body>` (or append it if absent).
 * @param {string} html Page HTML to augment.
 * @returns {string}
 */
export function injectDevClient(html: string): string;
/**
 * The dev-client browser script that opens the SSE channel for live reload.
 * @returns {string}
 */
export function devClientScript(): string;
export const devClientPath: "/__wd/dev-client.js";
export const devEventsPath: "/__wd/dev-events";
