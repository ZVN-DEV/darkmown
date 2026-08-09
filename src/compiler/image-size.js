// ---------------------------------------------------------------------------
// Intrinsic image dimensions, read straight from the file header.
//
// `enhanceImages` needs one number pair per `<img>` — the width and height the
// browser reserves so the page never reflows as an image decodes. That is a
// header read, not image decoding: every format we care about states its size
// in the first few dozen bytes. This module does exactly that much and nothing
// else, which is why it replaced the `image-size` dependency (whose ICNS/JXL/
// HEIF parsers ship a live denial-of-service advisory with no fixed release —
// unbounded loops on malformed input). We parse only the formats a Darkmown
// site actually references, and every loop here is bounded by the buffer
// length, so a truncated or hostile file terminates instead of spinning.
//
// Supported: PNG (including Apple's "fried" CgBI variant), JPEG (behind any
// number of leading APP/EXIF segments), GIF, WebP (VP8 lossy, VP8L lossless,
// VP8X extended), and SVG (root width/height in any CSS absolute unit, falling
// back to the viewBox). Anything else — and anything malformed — returns null,
// which `measureImage` treats exactly like a missing file: emit no dimensions
// and move on. A build must never fail because of an image.
// ---------------------------------------------------------------------------

/**
 * @typedef {{ width: number, height: number }} Dimensions Intrinsic pixel size.
 */

/** PNG's 8-byte file signature. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The chunk Apple's pngcrush (Xcode asset pipeline) inserts AHEAD of the IHDR,
 *  the one legal-in-the-wild violation of "IHDR is the first chunk". */
const PNG_FRIED_CHUNK = "CgBI";

/** The two GIF header versions in existence. */
const GIF_SIGNATURES = new Set(["GIF87a", "GIF89a"]);

/** How much of an unrecognized file to decode as text when sniffing for SVG.
 *  An SVG's root element is always in the first few hundred bytes; capping the
 *  decode keeps the scan constant-time on a large unknown binary. */
const SVG_SCAN_BYTES = 4096;

/** CSS absolute length units, in pixels. Font-relative units (`em`, `ex`, `rem`)
 *  and percentages depend on layout we do not have, so they are deliberately
 *  ABSENT: such an SVG falls back to its viewBox instead of to a guess. */
/** @type {Record<string, number>} */
const CSS_UNITS = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6
};

/**
 * Read an image's intrinsic dimensions from its header bytes.
 * @param {Uint8Array} bytes Raw file contents (a Node `Buffer` is a `Uint8Array`).
 * @returns {Dimensions | null} The size, or null when the bytes are empty, of an
 *   unsupported format, or malformed. Never throws.
 */
export function imageSize(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return null;
  // Ordered cheapest-magic-first; SVG is last because it is the only one that
  // has to decode text rather than compare a fixed byte signature.
  return png(bytes) ?? jpeg(bytes) ?? gif(bytes) ?? webp(bytes) ?? svg(bytes);
}

/**
 * PNG: the IHDR chunk is mandated to be the FIRST chunk, and carries the size
 * as two big-endian 32-bit fields. The one exception in the wild is an Apple
 * "fried" PNG, which pushes IHDR behind a `CgBI` chunk; skip that by its own
 * declared length rather than a hardcoded offset, and let the bounds check
 * below reject a length that points outside the file.
 * @param {Uint8Array} b
 * @returns {Dimensions | null}
 */
function png(b) {
  if (!matches(b, PNG_SIGNATURE, 0)) return null;
  // Chunk framing: 4-byte length, 4-byte type, payload, 4-byte CRC.
  let at = 8;
  if (b.length >= 16 && ascii(b, 12, 4) === PNG_FRIED_CHUNK) at += 12 + u32be(b, 8);
  if (b.length < at + 16 || ascii(b, at + 4, 4) !== "IHDR") return null;
  return dimensions(u32be(b, at + 8), u32be(b, at + 12));
}

/**
 * JPEG: the size lives in a Start-Of-Frame segment, which sits behind an
 * arbitrary run of APP0/APP1(EXIF)/COM/quantization segments, so the header has
 * to be walked. The walk is bounded twice over: `offset` only ever grows (by at
 * least one byte per pass), and the loop condition is the buffer length — a
 * truncated or self-contradictory file falls out instead of looping forever.
 * @param {Uint8Array} b
 * @returns {Dimensions | null}
 */
function jpeg(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 1 < b.length) {
    // Every segment begins at a marker boundary. Anything else means we lost
    // sync with the segment chain and can no longer trust our offsets.
    if (b[offset] !== 0xff) return null;
    const marker = b[offset + 1];
    // A run of 0xFF bytes is legal padding before the real marker type.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    offset += 2;
    // Standalone markers carry no payload: TEM (0x01) and the RST0-7 restarts.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    // End-of-image, or the start of entropy-coded scan data: past this point
    // there is no more header to read, so a missing SOF is simply unknowable.
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 1 >= b.length) return null;
    const length = u16be(b, offset);
    // The length field counts itself, and must fit inside the file — a segment
    // claiming to run past the end is the malformed case, not a short read.
    if (length < 2 || offset + length > b.length) return null;
    // SOF0-SOF15 hold the frame dimensions. C4/C8/CC share the range but are
    // DHT / JPG-extension / DAC segments, not frame headers.
    if (isStartOfFrame(marker)) {
      // precision (1) + height (2) + width (2) after the length field itself.
      if (length < 7) return null;
      return dimensions(u16be(b, offset + 5), u16be(b, offset + 3));
    }
    offset += length;
  }
  return null;
}

/**
 * Whether a JPEG marker is a Start-Of-Frame (the segment carrying dimensions).
 * @param {number} marker
 * @returns {boolean}
 */
function isStartOfFrame(marker) {
  if (marker < 0xc0 || marker > 0xcf) return false;
  return marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/**
 * GIF: the logical screen descriptor follows the 6-byte header immediately,
 * with little-endian 16-bit dimensions.
 * @param {Uint8Array} b
 * @returns {Dimensions | null}
 */
function gif(b) {
  if (b.length < 10 || !GIF_SIGNATURES.has(ascii(b, 0, 6))) return null;
  return dimensions(u16le(b, 6), u16le(b, 8));
}

/**
 * WebP: a RIFF container whose first chunk identifies the coding variant, each
 * of which stores the canvas size differently.
 * @param {Uint8Array} b
 * @returns {Dimensions | null}
 */
function webp(b) {
  if (b.length < 16 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") return null;
  const chunk = ascii(b, 12, 4);
  // Lossy: a 3-byte frame tag, the 9D 01 2A sync code, then 14-bit dimensions
  // (the top two bits of each 16-bit field are a scaling hint, not size).
  if (chunk === "VP8 ") {
    if (b.length < 30 || b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return dimensions(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  // Lossless: a 0x2F signature byte, then (width - 1) in the low 14 bits and
  // (height - 1) in the next 14 of one little-endian 32-bit word.
  if (chunk === "VP8L") {
    if (b.length < 25 || b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return dimensions((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  // Extended (alpha / animation / ICC): the canvas size as two 3-byte
  // little-endian (value - 1) fields, after the flag byte and 3 reserved bytes.
  if (chunk === "VP8X") {
    if (b.length < 30) return null;
    return dimensions(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}

/**
 * SVG: markup, not a binary header. The intrinsic size is the root element's
 * `width`/`height`; when those are absent or expressed in units we cannot
 * resolve to pixels (percentages, `em`), the `viewBox`'s third and fourth
 * numbers are the intrinsic size — that is the fallback browsers use too.
 * @param {Uint8Array} b
 * @returns {Dimensions | null}
 */
function svg(b) {
  const head = decodeHead(b);
  // Markup starts with `<` once a BOM / whitespace / XML declaration is past.
  // Bailing here keeps an unrecognized binary from being scanned as text.
  if (!/^\s*</.test(head)) return null;
  const open = head.match(/<svg\b[^>]*>/i);
  if (!open) return null;
  const width = svgLength(attr(open[0], "width"));
  const height = svgLength(attr(open[0], "height"));
  if (width !== null && height !== null) return dimensions(width, height);
  const box = viewBox(open[0]);
  if (!box) return null;
  // With one axis given, the viewBox supplies the aspect ratio for the other —
  // how a browser resolves an `auto` dimension. With neither, the viewBox is
  // itself the intrinsic size.
  if (width !== null) return dimensions(width, (width * box.height) / box.width);
  if (height !== null) return dimensions((height * box.width) / box.height, height);
  return dimensions(box.width, box.height);
}

/**
 * The width/height of an SVG root's `viewBox` (its third and fourth numbers).
 * Per the spec the four values are separated by whitespace and/or a comma.
 * @param {string} tag The `<svg …>` opening tag.
 * @returns {Dimensions | null}
 */
function viewBox(tag) {
  const raw = attr(tag, "viewBox");
  if (raw === null) return null;
  const parts = raw.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const width = Number(parts[2]);
  const height = Number(parts[3]);
  // Written as `!(x > 0)` so NaN — a non-numeric viewBox — is rejected too.
  if (!(width > 0) || !(height > 0)) return null;
  return { width, height };
}

/**
 * Read a quoted attribute value out of a single opening tag. The name must be
 * preceded by whitespace or a quote so `width` never matches `stroke-width`
 * (the same guard `ensureMainLandmark` uses for `id` vs `data-id`). Unquoted
 * values are not matched — rare in SVG, and the viewBox fallback covers them.
 * @param {string} tag One opening tag, `<` through `>`.
 * @param {string} name Attribute name (an internal constant, never user input).
 * @returns {string | null}
 */
function attr(tag, name) {
  const m = tag.match(new RegExp(`[\\s"']${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

/**
 * Parse an SVG length into CSS pixels. Unitless values are pixels, and the CSS
 * absolute units convert exactly ({@link CSS_UNITS} — `pt` is common in
 * Graphviz/Illustrator output). A percentage or a font-relative unit needs
 * layout we do not have, so it returns null and the caller falls back to the
 * viewBox — which is what a browser effectively does.
 * @param {string | null} value
 * @returns {number | null}
 */
function svgLength(value) {
  if (value === null) return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*([a-z]*)\s*$/i.exec(value);
  if (!m) return null;
  const scale = m[2] ? CSS_UNITS[m[2].toLowerCase()] : 1;
  return scale === undefined ? null : Number(m[1]) * scale;
}

/**
 * Decode the leading bytes of a file as UTF-8 text for the SVG sniff. Capped at
 * {@link SVG_SCAN_BYTES}; a truncated multi-byte sequence at the cap decodes to
 * a replacement character rather than throwing.
 * @param {Uint8Array} b
 * @returns {string}
 */
function decodeHead(b) {
  return new TextDecoder("utf-8").decode(b.subarray(0, SVG_SCAN_BYTES));
}

/**
 * Validate and normalize a parsed pair into the public shape. Non-numeric,
 * non-finite, and non-positive results are rejected — a zero or NaN dimension
 * on an `<img>` is worse than none at all.
 * @param {number} width
 * @param {number} height
 * @returns {Dimensions | null}
 */
function dimensions(width, height) {
  const w = Math.round(width);
  const h = Math.round(height);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { width: w, height: h };
}

/**
 * Whether the buffer carries an exact byte sequence at an offset.
 * @param {Uint8Array} b
 * @param {number[]} signature
 * @param {number} offset
 * @returns {boolean}
 */
function matches(b, signature, offset) {
  if (b.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (b[offset + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Read a fixed-length run of bytes as a Latin-1 string (format four-character
 * codes: `IHDR`, `RIFF`, `VP8L`, …). The caller guarantees the range is inside
 * the buffer.
 * @param {Uint8Array} b
 * @param {number} offset
 * @param {number} length
 * @returns {string}
 */
function ascii(b, offset, length) {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(b[offset + i]);
  return out;
}

/** @param {Uint8Array} b @param {number} i @returns {number} Big-endian uint16. */
function u16be(b, i) {
  return (b[i] << 8) | b[i + 1];
}

/** @param {Uint8Array} b @param {number} i @returns {number} Little-endian uint16. */
function u16le(b, i) {
  return b[i] | (b[i + 1] << 8);
}

/** @param {Uint8Array} b @param {number} i @returns {number} Big-endian uint32. */
function u32be(b, i) {
  // Multiply rather than shift the top byte: `<< 24` would go negative.
  return b[i] * 0x1000000 + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);
}

/** @param {Uint8Array} b @param {number} i @returns {number} Little-endian uint32. */
function u32le(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}

/** @param {Uint8Array} b @param {number} i @returns {number} Little-endian uint24. */
function u24le(b, i) {
  return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
}
