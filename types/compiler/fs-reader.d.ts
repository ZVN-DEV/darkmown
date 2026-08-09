/**
 * A {@link import("./reader.js").Reader} backed by `node:fs`. Each method is a
 * thin pass-through to the synchronous fs call the compiler used before the
 * reader abstraction, so an fs-backed compile stays byte-identical.
 * @returns {import("./reader.js").Reader}
 */
export function fsReader(): import("./reader.js").Reader;
