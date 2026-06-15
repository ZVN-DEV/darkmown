/**
 * Compile the whole site under `cwd` into `dist`, returning the route manifest.
 * @param {string} [cwd] Project working directory (defaults to `process.cwd()`).
 * @returns {{ routes: RouteManifestEntry[], distRoot: string }}
 */
export function buildSite(cwd?: string): {
    routes: RouteManifestEntry[];
    distRoot: string;
};
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
