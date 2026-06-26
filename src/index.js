// Public API barrel for @zvndev/darkmown.
// Mirrors the type surface declared in `types/index.d.ts`. Importing the
// package (`import { buildSite } from "@zvndev/darkmown"`) resolves here via the
// `exports` map; individual modules stay importable by their own path too.

export { buildSite } from "./builder.js";

export {
  compileDocument,
  compilePage,
  escapeHtml,
  loopKeyOf,
  parseFrontmatter
} from "./compiler.js";

export { createPaths, isHiddenName, pageExtensions } from "./config.js";
export { devClientScript, injectDevClient } from "./dev.js";
export { discoverRoutes, outputPathForRoute, routeFromFile } from "./router.js";

export { initProject } from "./scaffold.js";
export { compileSkin } from "./skin.js";
export { contentType, resolvePublicFile, serve } from "./statics.js";
