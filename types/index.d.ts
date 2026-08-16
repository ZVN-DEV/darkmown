// Public type surface for @zvndev/darkmown.
// Generated declarations live alongside this file (see `npm run types`).
// This entry re-exports the functions and shapes a consumer is expected to use.

export { buildSite } from "./builder.js";
export type { RouteManifestEntry, Paths, Assets } from "./builder.js";

export { directiveCatalog, llmsText } from "./catalog.js";
export type { DirectiveCatalog, DirectiveEntry, CatalogEntry, Reactivity } from "./catalog.js";

export {
  compilePage,
  compileDocument,
  compileFromMemory,
  parseFrontmatter,
  escapeHtml,
  loopKeyOf
} from "./compiler.js";
export type {
  Meta,
  FrontmatterValue,
  CompiledPage,
  CompiledDocument
} from "./compiler.js";

export { createPaths, isHiddenName, pageExtensions } from "./config.js";

export { discoverRoutes, routeFromFile, outputPathForRoute } from "./router.js";
export type { Route } from "./router.js";

export { compileSkin } from "./skin.js";

export { initProject } from "./scaffold.js";

export { serve, resolvePublicFile, contentType } from "./statics.js";

export { injectDevClient, devClientScript } from "./dev.js";
