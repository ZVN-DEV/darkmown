/**
 * Compile the whole site under `cwd` into `dist`, returning the route manifest.
 * @param {string} [cwd] Project working directory (defaults to `process.cwd()`).
 * @returns {{ routes: RouteManifestEntry[], distRoot: string }}
 */
export function buildSite(cwd?: string): {
    routes: RouteManifestEntry[];
    distRoot: string;
};
/**
 * Strip JSDoc `/** ... *\/` blocks from the runtime before it ships.
 * The source keeps full type annotations (for `checkJs` + `.d.ts`), but the
 * browser never needs to download them — this keeps the shipped runtime lean
 * and the gzip budget honest (measured against what users actually receive).
 * Only `/** ... *\/` blocks are removed; code and string literals are untouched.
 * @param {string} source
 * @returns {string}
 */
export function stripRuntimeComments(source: string): string;
export type Paths = import("./config.js").Paths;
export type Assets = import("./compiler.js").Assets;
/**
 * A built route entry written to `dist/routes.json`.
 */
export type RouteManifestEntry = {
    /**
     * Public route path.
     */
    route: string;
    /**
     * Source file path, relative to cwd, POSIX-separated.
     */
    file: string;
    assets: {
        skins: string[];
        scripts: string[];
        runtime: boolean;
    };
};
