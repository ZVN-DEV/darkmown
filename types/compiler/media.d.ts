/**
 * `:video /clip.mp4 [poster=…] [width=…] [height=…] [preload=…] [controls] [autoplay]
 * [loop] [muted] [playsinline]` and `:audio /track.mp3 [preload=…] [controls] …` →
 * a hardened `<video>`/`<audio>`. Defaults: `preload="metadata"`, and `controls`
 * unless the clip is an `autoplay` background (autoplay also implies `muted`, which
 * browsers require). Author flags/attrs always win. URLs use the `:fetch` scheme
 * guard (relative or http(s)).
 * @param {string} line
 * @param {"video" | "audio"} kind
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleMedia(line: string, kind: "video" | "audio", ctx: Ctx, index: number): string;
/**
 * `:embed <url> [title="…"]` → a lazy, privacy-friendly responsive iframe. A
 * YouTube or Vimeo URL is rewritten to its no-cookie / player embed; any other
 * http(s) URL becomes a generic 16:9 iframe. Inline styles keep the wrapper
 * self-contained (no framework CSS), so an embed-only page stays zero-JS/zero-CSS.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEmbed(line: string, ctx: Ctx, index: number): string;
/**
 * @typedef {import("./context.js").Ctx} Ctx
 */
export const VIDEO_EXAMPLE: ":video /demo.mp4 controls";
export const AUDIO_EXAMPLE: ":audio /theme.mp3 controls";
export const EMBED_EXAMPLE: ":embed https://youtu.be/dQw4w9WgXcQ title=\"Demo\"";
export type Ctx = import("./context.js").Ctx;
