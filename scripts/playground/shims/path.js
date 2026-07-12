// A minimal POSIX `path` shim for the browser playground bundle. The compiler
// only ever deals with POSIX-style virtual paths in the memory reader
// (`/site/pages/preview.wd`), so a small, correct POSIX implementation of the
// handful of functions the compiler uses is enough — and keeps the bundle free
// of a third-party path polyfill dependency.

export const sep = "/";

/**
 * Normalize an already-joined POSIX path: collapse `.`/`..` segments and repeated
 * slashes, preserving a leading slash and a trailing slash.
 * @param {string} p
 * @returns {string}
 */
function normalizeString(p) {
  const isAbs = p.startsWith("/");
  const trailing = p.length > 1 && p.endsWith("/");
  /** @type {string[]} */
  const out = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!isAbs) out.push("..");
    } else {
      out.push(seg);
    }
  }
  let joined = out.join("/");
  if (isAbs) joined = `/${joined}`;
  else if (joined === "") joined = ".";
  if (trailing && !joined.endsWith("/")) joined += "/";
  return joined;
}

/**
 * @param {...string} parts
 * @returns {string}
 */
export function join(...parts) {
  const joined = parts.filter((part) => typeof part === "string" && part.length > 0).join("/");
  return joined === "" ? "." : normalizeString(joined);
}

/**
 * @param {...string} parts
 * @returns {string}
 */
export function resolve(...parts) {
  let resolved = "";
  let isAbs = false;
  for (let i = parts.length - 1; i >= 0 && !isAbs; i--) {
    const part = parts[i];
    if (typeof part !== "string" || part.length === 0) continue;
    resolved = `${part}/${resolved}`;
    isAbs = part.startsWith("/");
  }
  if (!isAbs) resolved = `/${resolved}`; // virtual root is absolute
  const normalized = normalizeString(resolved);
  return normalized.length > 1 && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * @param {string} p
 * @returns {string}
 */
export function dirname(p) {
  if (p.length === 0) return ".";
  const trimmed = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  const idx = trimmed.lastIndexOf("/");
  if (idx === -1) return ".";
  if (idx === 0) return "/";
  return trimmed.slice(0, idx);
}

/**
 * @param {string} p
 * @param {string} [ext] An extension to strip from the result.
 * @returns {string}
 */
export function basename(p, ext) {
  const trimmed = p.endsWith("/") && p.length > 1 ? p.slice(0, -1) : p;
  const base = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  if (ext && base !== ext && base.endsWith(ext)) return base.slice(0, -ext.length);
  return base;
}

/**
 * @param {string} p
 * @returns {string}
 */
export function extname(p) {
  const base = basename(p);
  const dot = base.lastIndexOf(".");
  return dot <= 0 ? "" : base.slice(dot);
}

/**
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function relative(from, to) {
  const fromParts = resolve(from).split("/").filter(Boolean);
  const toParts = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const up = fromParts.slice(i).map(() => "..");
  return [...up, ...toParts.slice(i)].join("/");
}

export default { sep, join, resolve, dirname, basename, extname, relative };
