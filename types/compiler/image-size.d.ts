/**
 * Read an image's intrinsic dimensions from its header bytes.
 * @param {Uint8Array} bytes Raw file contents (a Node `Buffer` is a `Uint8Array`).
 * @returns {Dimensions | null} The size, or null when the bytes are empty, of an
 *   unsupported format, or malformed. Never throws.
 */
export function imageSize(bytes: Uint8Array): Dimensions | null;
/**
 * Intrinsic pixel size.
 */
export type Dimensions = {
    width: number;
    height: number;
};
