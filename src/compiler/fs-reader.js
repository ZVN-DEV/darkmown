// ---------------------------------------------------------------------------
// The default {@link import("./reader.js").Reader}: reads straight from the
// real filesystem. This is the ONLY compiler module that imports `node:fs`, so
// it is deliberately isolated — nothing reachable from `compileFromMemory`
// imports it, keeping the browser/mobile compile path fs-free. The public
// `compilePage`/`compileDocument`/`enhanceImages` (in `src/compiler.js`) inject
// this reader by default, so every existing caller keeps working unchanged.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import { normalizeNewlines } from "./context.js";

/**
 * A {@link import("./reader.js").Reader} backed by `node:fs`. Each method is a
 * thin pass-through to the synchronous fs call the compiler used before the
 * reader abstraction, so an fs-backed compile stays byte-identical.
 * @returns {import("./reader.js").Reader}
 */
export function fsReader() {
  return {
    readText: (absPath) => normalizeNewlines(fs.readFileSync(absPath, "utf8")),
    readBinary: (absPath) => fs.readFileSync(absPath),
    exists: (absPath) => fs.existsSync(absPath),
    realpath: (absPath) => fs.realpathSync(absPath)
  };
}
