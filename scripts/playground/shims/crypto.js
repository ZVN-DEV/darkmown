// A tiny `node:crypto` shim for the browser playground bundle. The only crypto
// the compile path reaches is `scopeIdFor` (a `.skin` whose first line is
// `scoped`), which hashes the skin's relative path to a short scope id. The
// playground's seeded examples use no scoped skins, so this is effectively dead
// at runtime — but it must exist for the bundle to build. A deterministic
// non-cryptographic hash (FNV-1a) is sufficient: scope ids only need internal
// consistency (the stamp and the compiled selectors derive from the same id).

/**
 * @param {string} _algo Ignored — the shim uses one hash regardless.
 * @returns {{ update: (data: string) => any, digest: (enc?: string) => string }}
 */
export function createHash(_algo) {
  let hash = 0x811c9dc5;
  return {
    update(data) {
      const str = String(data);
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      return this;
    },
    digest() {
      // Return 8 hex chars; callers slice what they need (scopeIdFor takes 4).
      return (hash >>> 0).toString(16).padStart(8, "0");
    }
  };
}

export default { createHash };
