// ---------------------------------------------------------------------------
// Media — :video / :audio / :embed. Compile-time only (zero runtime): hardened
// HTML5 media and privacy-friendly, lazy iframe embeds. The extension stays the
// feature gate; these emit no `data-wd-*`, so a media-only page ships zero JS.
//
// Every handler receives the 0-based line `index` so its malformed/invalid
// errors report `file:line` (via `at`) — matching the unclosed-block errors —
// while keeping the message text and `Use:` hints intact.
// ---------------------------------------------------------------------------

import { at, lineOf, wdError } from "./context.js";
import { validateFetchUrl } from "./fetch.js";
import { escapeHtml, stripQuotes } from "./interpolation.js";

/**
 * @typedef {import("./context.js").Ctx} Ctx
 */

// Concrete, compilable media examples for the hint tails + the directive catalog.
export const VIDEO_EXAMPLE = ":video /demo.mp4 controls";
export const AUDIO_EXAMPLE = ":audio /theme.mp3 controls";
export const EMBED_EXAMPLE = ':embed https://youtu.be/dQw4w9WgXcQ title="Demo"';

/** @type {Record<"video" | "audio", { flags: string[], attrs: string[] }>} */
const MEDIA_SPEC = {
  video: {
    flags: ["controls", "autoplay", "loop", "muted", "playsinline"],
    attrs: ["poster", "width", "height", "preload"]
  },
  audio: { flags: ["controls", "autoplay", "loop", "muted"], attrs: ["preload"] }
};

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
export function handleMedia(line, kind, ctx, index) {
  const match = line.match(new RegExp(`^:${kind}\\s+(\\S+)\\s*(.*)$`));
  if (!match) {
    const example = kind === "video" ? VIDEO_EXAMPLE : AUDIO_EXAMPLE;
    const hint = `:${kind} /clip [controls] [autoplay] [loop] [muted] — e.g. ${example}`;
    throw wdError(`Malformed :${kind} in ${at(ctx, index)}: ${line}. Use: ${hint}`, {
      code: "WD701",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example
    });
  }
  const src = validateFetchUrl(stripQuotes(match[1]), ctx, `:${kind}`);
  const spec = MEDIA_SPEC[kind];
  /** @type {Set<string>} */
  const flags = new Set();
  /** @type {Map<string, string>} */
  const attrs = new Map();
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)|([A-Za-z-]+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (token[3]) {
      if (!spec.flags.includes(token[3]))
        throw wdError(`Unknown :${kind} flag "${token[3]}" in ${at(ctx, index)}`, {
          code: "WD702",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      flags.add(token[3]);
    } else {
      if (!spec.attrs.includes(token[1]))
        throw wdError(`Unknown :${kind} attribute "${token[1]}" in ${at(ctx, index)}`, {
          code: "WD703",
          file: ctx.file,
          line: lineOf(ctx, index)
        });
      attrs.set(token[1], stripQuotes(token[2]));
    }
  }
  // Sensible defaults; author input always wins.
  if (flags.has("autoplay")) flags.add("muted"); // browsers block unmuted autoplay
  if (kind === "audio" || !flags.has("autoplay")) flags.add("controls");
  const parts = [`src="${escapeHtml(src)}"`];
  if (attrs.has("poster"))
    parts.push(
      `poster="${escapeHtml(validateFetchUrl(/** @type {string} */ (attrs.get("poster")), ctx, `:${kind} poster`))}"`
    );
  for (const name of ["width", "height"]) {
    if (attrs.has(name))
      parts.push(`${name}="${escapeHtml(/** @type {string} */ (attrs.get(name)))}"`);
  }
  parts.push(`preload="${escapeHtml(attrs.get("preload") || "metadata")}"`);
  for (const flag of spec.flags) if (flags.has(flag)) parts.push(flag);
  return `<${kind} ${parts.join(" ")}></${kind}>`;
}

/**
 * The attributes `:embed` accepts beyond its URL.
 * @type {string[]}
 */
const EMBED_ATTRS = ["title", "height", "aspect", "allow"];

/**
 * The iframe permission tokens an `:embed allow="…"` value may name. A closed
 * whitelist: the iframe is a third-party document, so the page states exactly
 * which capabilities it hands over rather than passing an arbitrary string
 * through.
 * @type {string[]}
 */
export const EMBED_ALLOW_TOKENS = [
  "payment",
  "autoplay",
  "encrypted-media",
  "fullscreen",
  "picture-in-picture",
  "clipboard-write",
  "camera",
  "microphone",
  "geolocation"
];

// The default permission set every embed shipped before `allow=` existed.
// Kept byte-identical so an embed with no `allow=` attribute is unchanged.
const EMBED_ALLOW_DEFAULT =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";

/**
 * `:embed <url> [title="…"] [height=<css length>] [aspect=<w>:<h>] [allow="…"]` →
 * a lazy, privacy-friendly responsive iframe. A YouTube or Vimeo URL is
 * rewritten to its no-cookie / player embed; any other http(s) URL becomes a
 * generic 16:9 iframe. Inline styles keep the wrapper self-contained (no
 * framework CSS), so an embed-only page stays zero-JS/zero-CSS.
 *
 * Sizing: the default box is 16:9. `aspect=4:3` swaps in a different ratio;
 * `height=400px` drops the ratio box and pins the frame's height instead (it
 * wins over `aspect` when both are given). `allow="payment clipboard-write"`
 * REPLACES the default iframe permission set — each token must be on the
 * {@link EMBED_ALLOW_TOKENS} whitelist, so a typo is a compile error rather
 * than a silently broken embed.
 * @param {string} line
 * @param {Ctx} ctx
 * @param {number} index 0-based line index for `file:line` errors.
 * @returns {string}
 */
export function handleEmbed(line, ctx, index) {
  const match = line.match(/^:embed\s+(\S+)\s*(.*)$/);
  if (!match) {
    const hint = `:embed https://youtu.be/ID [title="…"] — e.g. ${EMBED_EXAMPLE}`;
    throw wdError(`Malformed :embed in ${at(ctx, index)}: ${line}. Use: ${hint}`, {
      code: "WD704",
      file: ctx.file,
      line: lineOf(ctx, index),
      hint,
      example: EMBED_EXAMPLE
    });
  }
  const raw = stripQuotes(match[1]);
  /** @type {Map<string, string>} */
  const attrs = new Map();
  const re = /([A-Za-z-]+)=("[^"]*"|\S+)/g;
  for (const token of (match[2] || "").matchAll(re)) {
    if (!EMBED_ATTRS.includes(token[1]))
      throw wdError(`Unknown :embed attribute "${token[1]}" in ${at(ctx, index)}`, {
        code: "WD705",
        file: ctx.file,
        line: lineOf(ctx, index)
      });
    attrs.set(token[1], stripQuotes(token[2]));
  }
  const sizing = embedSizing(attrs, ctx, index);
  const allow = embedAllow(attrs, ctx, index);
  const { url, label } = resolveEmbed(raw, ctx);
  recordEmbedHost(ctx, url);
  const title = attrs.get("title") || "";
  const iframe =
    `<iframe src="${escapeHtml(url)}" title="${escapeHtml(title || label)}" loading="lazy" ` +
    `referrerpolicy="strict-origin-when-cross-origin" ` +
    `allow="${escapeHtml(allow)}" ` +
    `allowfullscreen style="width:100%;height:100%;border:0"></iframe>`;
  return `<div class="wd-embed" style="${sizing}">${iframe}</div>`;
}

/**
 * The wrapper's sizing style: a pinned `height`, a custom `aspect` ratio, or
 * the default 16:9 box. Both author values are shape-validated so a typo fails
 * the build instead of shipping a style the browser drops.
 * @param {Map<string, string>} attrs
 * @param {Ctx} ctx
 * @param {number} index
 * @returns {string}
 */
function embedSizing(attrs, ctx, index) {
  const height = attrs.get("height");
  if (height !== undefined) {
    if (!/^\d+(?:\.\d+)?(?:px|rem|em|vh|vw|%)$/.test(height))
      throw wdError(
        `Invalid :embed height "${height}" in ${at(ctx, index)}. Use: a CSS length like height=400px or height=24rem.`,
        { code: "WD707", file: ctx.file, line: lineOf(ctx, index) }
      );
    return `height:${height}`;
  }
  const aspect = attrs.get("aspect");
  if (aspect !== undefined) {
    if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(aspect))
      throw wdError(
        `Invalid :embed aspect "${aspect}" in ${at(ctx, index)}. Use: a width:height ratio like aspect=4:3.`,
        { code: "WD707", file: ctx.file, line: lineOf(ctx, index) }
      );
    return `aspect-ratio:${aspect.replace(":", "/")}`;
  }
  return "aspect-ratio:16/9";
}

/**
 * The iframe `allow` value: the author's whitelisted token list, or the
 * default permission set when no `allow=` attribute is present.
 * @param {Map<string, string>} attrs
 * @param {Ctx} ctx
 * @param {number} index
 * @returns {string}
 */
function embedAllow(attrs, ctx, index) {
  const raw = attrs.get("allow");
  if (raw === undefined) return EMBED_ALLOW_DEFAULT;
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!EMBED_ALLOW_TOKENS.includes(token))
      throw wdError(
        `Unknown :embed allow token "${token}" in ${at(ctx, index)}. Use: ${EMBED_ALLOW_TOKENS.join(", ")}.`,
        { code: "WD706", file: ctx.file, line: lineOf(ctx, index) }
      );
  }
  return tokens.join("; ");
}

/**
 * Record the frame source the emitted iframe actually loads, so the builder can
 * union it into this route's CSP `frame-src`. An absolute http(s) URL contributes
 * its origin; a relative URL frames the page's own origin, so it contributes
 * `'self'`. A `{ state }`-driven URL is unknowable at compile time and records
 * nothing (widening that policy is the app's deploy-config decision, exactly
 * like a remote `:fetch` target widening `connect-src`).
 * @param {Ctx} ctx
 * @param {string} url The FINAL iframe src (post YouTube/Vimeo rewrite).
 * @returns {void}
 */
function recordEmbedHost(ctx, url) {
  if (url.startsWith("{")) return;
  if (!/^https?:\/\//i.test(url)) {
    ctx.comp.assets.embedHosts.add("'self'");
    return;
  }
  try {
    ctx.comp.assets.embedHosts.add(new URL(url).origin);
  } catch {
    /* a malformed-but-scheme-valid URL paints as-is; nothing to authorize */
  }
}

/**
 * Map a watch/share URL to its embeddable form. YouTube → no-cookie embed, Vimeo →
 * player; anything else is validated as a generic http(s) iframe source.
 * @param {string} raw
 * @param {Ctx} ctx
 * @returns {{ url: string, label: string }}
 */
function resolveEmbed(raw, ctx) {
  const youtube = raw.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{6,})/
  );
  if (youtube)
    return { url: `https://www.youtube-nocookie.com/embed/${youtube[1]}`, label: "YouTube video" };
  const vimeo = raw.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeo) return { url: `https://player.vimeo.com/video/${vimeo[1]}`, label: "Vimeo video" };
  return { url: validateFetchUrl(raw, ctx, ":embed"), label: "Embedded content" };
}
