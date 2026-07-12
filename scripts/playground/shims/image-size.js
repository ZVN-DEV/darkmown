// An `image-size` stub for the browser playground bundle. The playground has no
// image files, and the memory reader's `readBinary` throws before `imageSize` is
// ever called (measureImage catches it and degrades to "no dimensions"). This
// stub only has to exist so the bundle builds without pulling the real, fs- and
// Buffer-dependent image-size package into the browser.

/**
 * @returns {{ width: number, height: number }}
 */
export function imageSize() {
  throw new Error("image-size is unavailable in the browser playground");
}

export default { imageSize };
