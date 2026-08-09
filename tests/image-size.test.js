// Header-only image measurement. `enhanceImages` needs one width/height pair per
// <img> so the browser can reserve space; that is a header read, not a decode.
// This suite pins the parser for every format a Darkmown site actually
// references (PNG, JPEG, GIF, WebP, SVG) and — just as importantly — pins the
// failure mode: truncated, self-contradictory, and unsupported bytes return
// null instead of throwing or spinning. The dependency this replaced shipped a
// live denial-of-service advisory for exactly that class of input, so every
// malformed case below is a regression test against reintroducing it.

import assert from "node:assert/strict";
import test from "node:test";
import { imageSize } from "../src/compiler/image-size.js";

// --- fixture builders (bytes constructed here, no binary files committed) ----

/** Latin-1 string → bytes. */
function bytes(text) {
  return Uint8Array.from(text, (ch) => ch.charCodeAt(0));
}

/** Concatenate byte arrays / plain number arrays into one Uint8Array. */
function concat(...parts) {
  const flat = parts.flatMap((p) => Array.from(p));
  return Uint8Array.from(flat);
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** A PNG header: signature + the mandatory first IHDR chunk. */
function png(w, h, type = "IHDR") {
  const b = new Uint8Array(24);
  b.set(PNG_SIGNATURE, 0);
  const view = new DataView(b.buffer);
  view.setUint32(8, 13); // IHDR payload length
  b.set(bytes(type), 12);
  view.setUint32(16, w);
  view.setUint32(20, h);
  return b;
}

/** An Apple "fried" PNG: a CgBI chunk wedged ahead of the IHDR. */
function friedPng(w, h, cgbiLength = 4) {
  const head = new Uint8Array(16);
  head.set(PNG_SIGNATURE, 0);
  const view = new DataView(head.buffer);
  view.setUint32(8, cgbiLength);
  head.set(bytes("CgBI"), 12);
  // CgBI payload + CRC, then the real IHDR chunk with the signature stripped.
  return concat(head, new Uint8Array(cgbiLength + 4), png(w, h).subarray(8));
}

/** A GIF header + logical screen descriptor. */
function gif(w, h, signature = "GIF89a") {
  const b = new Uint8Array(13);
  b.set(bytes(signature), 0);
  const view = new DataView(b.buffer);
  view.setUint16(6, w, true);
  view.setUint16(8, h, true);
  return b;
}

/** One JPEG segment: marker + a self-inclusive 16-bit length + payload. */
function segment(marker, payload) {
  const length = payload.length + 2;
  return concat([0xff, marker, length >> 8, length & 0xff], payload);
}

/** A Start-Of-Frame segment (precision, height, width, component count). */
function sof(w, h, marker = 0xc0) {
  return segment(marker, [8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3]);
}

/** A JPEG: SOI, any leading segments, then the SOF carrying the dimensions. */
function jpeg(w, h, leading = []) {
  return concat([0xff, 0xd8], leading, sof(w, h));
}

/** A RIFF/WEBP container wrapping one coding chunk. */
function webp(fourcc, payload) {
  const b = new Uint8Array(20 + payload.length);
  const view = new DataView(b.buffer);
  b.set(bytes("RIFF"), 0);
  view.setUint32(4, 12 + payload.length, true);
  b.set(bytes("WEBP"), 8);
  b.set(bytes(fourcc), 12);
  view.setUint32(16, payload.length, true);
  b.set(payload, 20);
  return b;
}

/** Lossy WebP: frame tag, 9D 01 2A sync code, 14-bit dimensions. */
function vp8(w, h, sync = [0x9d, 0x01, 0x2a]) {
  const p = new Uint8Array(10);
  p.set(sync, 3);
  const view = new DataView(p.buffer);
  view.setUint16(6, w, true);
  view.setUint16(8, h, true);
  return webp("VP8 ", p);
}

/** Lossless WebP: 0x2F signature, then (w-1) and (h-1) packed into 28 bits. */
function vp8l(w, h, signature = 0x2f) {
  const p = new Uint8Array(5);
  p[0] = signature;
  new DataView(p.buffer).setUint32(1, ((w - 1) | ((h - 1) << 14)) >>> 0, true);
  return webp("VP8L", p);
}

/** Extended WebP: flags, 3 reserved bytes, then two 3-byte (value-1) fields. */
function vp8x(w, h) {
  const p = new Uint8Array(10);
  const put24 = (at, v) => {
    p[at] = v & 0xff;
    p[at + 1] = (v >> 8) & 0xff;
    p[at + 2] = (v >> 16) & 0xff;
  };
  put24(4, w - 1);
  put24(7, h - 1);
  return webp("VP8X", p);
}

/** UTF-8 text as bytes (SVG is markup, not a binary header). */
function text(source) {
  return new TextEncoder().encode(source);
}

// --- PNG --------------------------------------------------------------------

test("PNG: dimensions come from the IHDR chunk", () => {
  assert.deepEqual(imageSize(png(640, 360)), { width: 640, height: 360 });
});

test("PNG: a Node Buffer works exactly like a Uint8Array", () => {
  assert.deepEqual(imageSize(Buffer.from(png(1200, 630))), { width: 1200, height: 630 });
});

test("PNG: large dimensions do not overflow the 32-bit read", () => {
  assert.deepEqual(imageSize(png(0x7fffffff, 4)), { width: 0x7fffffff, height: 4 });
});

test("PNG: truncated after the signature is unmeasurable, not a throw", () => {
  assert.equal(imageSize(Uint8Array.from(PNG_SIGNATURE)), null);
});

test("PNG: a first chunk that is not IHDR is rejected", () => {
  assert.equal(imageSize(png(640, 360, "IDAT")), null);
});

test("PNG: a zero dimension is rejected rather than emitted", () => {
  assert.equal(imageSize(png(0, 360)), null);
});

test("PNG: an Apple 'fried' CgBI chunk ahead of the IHDR is skipped", () => {
  // Xcode's asset pipeline rewrites PNGs this way, so one can plausibly land in
  // a site's media shelf. The IHDR is found behind CgBI, not at a fixed offset.
  assert.deepEqual(imageSize(friedPng(48, 48)), { width: 48, height: 48 });
});

test("PNG: a CgBI chunk whose length points past the file is rejected", () => {
  assert.equal(imageSize(friedPng(48, 48).subarray(0, 20)), null);
});

// --- JPEG -------------------------------------------------------------------

test("JPEG: dimensions come from the SOF0 frame header", () => {
  assert.deepEqual(imageSize(jpeg(1200, 675)), { width: 1200, height: 675 });
});

test("JPEG: the SOF is found behind leading JFIF and EXIF segments", () => {
  const jfif = segment(0xe0, [...bytes("JFIF"), 0, 1, 2, 0, 0, 1, 0, 1, 0, 0]);
  const exif = segment(0xe1, [...bytes("Exif"), 0, 0, ...new Uint8Array(64).fill(0x20)]);
  const comment = segment(0xfe, [...bytes("Lavc62.11.100")]);
  assert.deepEqual(imageSize(jpeg(640, 360, concat(jfif, exif, comment))), {
    width: 640,
    height: 360
  });
});

test("JPEG: progressive frames (SOF2) measure the same as baseline", () => {
  const file = concat([0xff, 0xd8], sof(320, 240, 0xc2));
  assert.deepEqual(imageSize(file), { width: 320, height: 240 });
});

test("JPEG: a Huffman table (0xC4) is not mistaken for a frame header", () => {
  const dht = segment(0xc4, [0x00, 0x01, 0x02]);
  assert.deepEqual(imageSize(jpeg(48, 24, dht)), { width: 48, height: 24 });
});

test("JPEG: 0xFF padding runs before a marker are skipped", () => {
  const file = concat([0xff, 0xd8, 0xff, 0xff, 0xff], sof(96, 64).slice(1));
  assert.deepEqual(imageSize(file), { width: 96, height: 64 });
});

test("JPEG: standalone restart markers carry no payload and are stepped over", () => {
  assert.deepEqual(imageSize(jpeg(80, 40, [0xff, 0xd3])), { width: 80, height: 40 });
});

test("JPEG: losing marker sync bails out instead of walking garbage", () => {
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0x00, 0x11, 0x22, 0x33])), null);
});

test("JPEG: scan data reached before any frame header is unmeasurable", () => {
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08])), null);
});

test("JPEG: truncated mid-marker, before its length field", () => {
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), null);
});

test("JPEG: a segment claiming to run past the end of the file is rejected", () => {
  // Length says 0x2000 bytes but only a handful follow — the exact shape of
  // input that sends a naive parser off the end or into a loop.
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x20, 0x00, 0x01])), null);
});

test("JPEG: a frame header too short to hold dimensions is rejected", () => {
  assert.equal(imageSize(concat([0xff, 0xd8], segment(0xc0, [8, 0]))), null);
});

test("JPEG: a header that ends with no frame header at all", () => {
  assert.equal(imageSize(concat([0xff, 0xd8], segment(0xe0, [0, 0, 0, 0]))), null);
});

test("JPEG: SOI alone is too short to parse", () => {
  assert.equal(imageSize(Uint8Array.from([0xff, 0xd8])), null);
});

// --- GIF --------------------------------------------------------------------

test("GIF: dimensions come from the logical screen descriptor", () => {
  assert.deepEqual(imageSize(gif(300, 200)), { width: 300, height: 200 });
});

test("GIF: the 87a header is accepted too", () => {
  assert.deepEqual(imageSize(gif(16, 16, "GIF87a")), { width: 16, height: 16 });
});

test("GIF: an unknown version header is not a GIF", () => {
  assert.equal(imageSize(gif(300, 200, "GIF80a")), null);
});

test("GIF: truncated before the screen descriptor", () => {
  assert.equal(imageSize(bytes("GIF89a")), null);
});

// --- WebP -------------------------------------------------------------------

test("WebP VP8 (lossy): 14-bit dimensions after the sync code", () => {
  assert.deepEqual(imageSize(vp8(1024, 768)), { width: 1024, height: 768 });
});

test("WebP VP8: a wrong sync code is rejected", () => {
  assert.equal(imageSize(vp8(1024, 768, [0x00, 0x00, 0x00])), null);
});

test("WebP VP8: truncated payload", () => {
  assert.equal(imageSize(webp("VP8 ", new Uint8Array(4))), null);
});

test("WebP VP8L (lossless): dimensions are stored as value-1 in packed bits", () => {
  assert.deepEqual(imageSize(vp8l(400, 300)), { width: 400, height: 300 });
});

test("WebP VP8L: the maximum 14-bit dimension round-trips", () => {
  assert.deepEqual(imageSize(vp8l(16384, 16384)), { width: 16384, height: 16384 });
});

test("WebP VP8L: a missing 0x2F signature byte is rejected", () => {
  assert.equal(imageSize(vp8l(400, 300, 0x00)), null);
});

test("WebP VP8L: truncated payload", () => {
  assert.equal(imageSize(webp("VP8L", new Uint8Array(2))), null);
});

test("WebP VP8X (extended): the canvas size comes from the 3-byte fields", () => {
  assert.deepEqual(imageSize(vp8x(2000, 1500)), { width: 2000, height: 1500 });
});

test("WebP VP8X: truncated payload", () => {
  assert.equal(imageSize(webp("VP8X", new Uint8Array(4))), null);
});

test("WebP: an unknown coding chunk is unmeasurable", () => {
  assert.equal(imageSize(webp("ANIM", new Uint8Array(16))), null);
});

test("WebP: a RIFF container that is not WEBP is not ours", () => {
  const wav = concat(bytes("RIFF"), [0, 0, 0, 0], bytes("WAVE"), bytes("fmt "));
  assert.equal(imageSize(wav), null);
});

// --- SVG --------------------------------------------------------------------

test("SVG: explicit width/height attributes win", () => {
  assert.deepEqual(imageSize(text('<svg width="32" height="16"></svg>')), {
    width: 32,
    height: 16
  });
});

test("SVG: px units and an XML declaration are handled", () => {
  const source = '<?xml version="1.0"?>\n<svg xmlns="…" width="120px" height=" 90 px "/>';
  assert.deepEqual(imageSize(text(source)), { width: 120, height: 90 });
});

test("SVG: fractional lengths round to whole pixels", () => {
  assert.deepEqual(imageSize(text('<svg width="32.4" height="16.6"/>')), {
    width: 32,
    height: 17
  });
});

test("SVG: with no width/height, the viewBox is the intrinsic size", () => {
  // The demo site's own logo — a viewBox-only <svg> whose CHILD <rect> carries
  // width/height that must not be mistaken for the root element's.
  const logo =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect width="64" height="64" rx="6" fill="#18221d"/></svg>';
  assert.deepEqual(imageSize(text(logo)), { width: 32, height: 32 });
});

test("SVG: a comma-separated viewBox with a non-zero origin", () => {
  assert.deepEqual(imageSize(text('<svg viewBox="-10,-10,220,110"/>')), {
    width: 220,
    height: 110
  });
});

test("SVG: percentage sizing falls back to the viewBox", () => {
  const source = '<svg width="100%" height="100%" viewBox="0 0 800 600"/>';
  assert.deepEqual(imageSize(text(source)), { width: 800, height: 600 });
});

test("SVG: a stroke-width attribute never masquerades as width", () => {
  assert.deepEqual(imageSize(text('<svg stroke-width="4" viewBox="0 0 24 24"/>')), {
    width: 24,
    height: 24
  });
});

test("SVG: point units convert to CSS pixels", () => {
  // Graphviz and Illustrator both emit `pt`; 1pt = 4/3px, so a browser lays
  // this out at 2372x1311 and the reserved box has to match.
  assert.deepEqual(imageSize(text('<svg width="1779pt" height="983pt"/>')), {
    width: 2372,
    height: 1311
  });
});

test("SVG: a font-relative unit is unresolvable and defers to the viewBox", () => {
  assert.deepEqual(imageSize(text('<svg width="20em" height="10em" viewBox="0 0 64 32"/>')), {
    width: 64,
    height: 32
  });
});

test("SVG: a width alone takes its height from the viewBox ratio", () => {
  assert.deepEqual(imageSize(text('<svg width="10" viewBox="0 0 50 25"/>')), {
    width: 10,
    height: 5
  });
});

test("SVG: a height alone takes its width from the viewBox ratio", () => {
  assert.deepEqual(imageSize(text('<svg height="30" viewBox="0 0 50 25"/>')), {
    width: 60,
    height: 30
  });
});

test("SVG: a degenerate zero-area viewBox is rejected", () => {
  assert.equal(imageSize(text('<svg viewBox="0 0 0 25"/>')), null);
});

test("SVG: neither sizing attributes nor a viewBox is unmeasurable", () => {
  assert.equal(imageSize(text("<svg><circle/></svg>")), null);
});

test("SVG: a malformed viewBox is rejected", () => {
  assert.equal(imageSize(text('<svg viewBox="0 0 32"/>')), null);
});

test("SVG: a non-numeric viewBox is rejected", () => {
  assert.equal(imageSize(text('<svg viewBox="a b c d"/>')), null);
});

test("SVG: markup with no <svg> root is not an image", () => {
  assert.equal(imageSize(text("<html><body>not an image</body></html>")), null);
});

// --- unsupported + degenerate input ----------------------------------------

test("an unsupported binary format is unmeasurable, not a throw", () => {
  const bmp = concat(bytes("BM"), [0x46, 0x00, 0x00, 0x00, 0, 0, 0, 0, 0x36, 0, 0, 0]);
  assert.equal(imageSize(bmp), null);
});

test("empty and non-buffer input return null", () => {
  assert.equal(imageSize(new Uint8Array(0)), null);
  assert.equal(imageSize(null), null);
  assert.equal(imageSize(undefined), null);
});

test("a single stray byte returns null", () => {
  assert.equal(imageSize(Uint8Array.from([0xff])), null);
});

test("a large hostile buffer of noise terminates", () => {
  // 256 KB with no recognizable header: the SVG sniff must cap its text decode
  // and every parser must bail on its own magic rather than scan the file.
  const noise = new Uint8Array(256 * 1024).fill(0xff);
  assert.equal(imageSize(noise), null);
});

test("a JPEG that is nothing but marker padding terminates", () => {
  // 256 KB of 0xFF behind a valid SOI: the segment walk takes the padding
  // branch on every pass, so it must still advance and finish. An unbounded
  // parser hangs here — this is the advisory class the dependency drop closed.
  const padded = new Uint8Array(256 * 1024).fill(0xff);
  padded[1] = 0xd8;
  assert.equal(imageSize(padded), null);
});
