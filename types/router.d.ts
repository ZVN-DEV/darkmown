/**
 * A discovered page route: the source file and its public route path.
 * @typedef {object} Route
 * @property {string} file Absolute path to the source `.md`/`.wd` file.
 * @property {string} route Public route path (always trailing-slashed, e.g. `/about/`).
 */
/**
 * Walk `routesRoot` and collect page routes, sorted and de-duplicated.
 * @param {string} routesRoot Absolute path to `site/pages`.
 * @returns {Route[]}
 */
export function discoverRoutes(routesRoot: string): Route[];
/**
 * Derive a public route path from a source file path.
 * @param {string} routesRoot Absolute path to `site/pages`.
 * @param {string} file Absolute path to the source file.
 * @returns {string}
 */
export function routeFromFile(routesRoot: string, file: string): string;
/**
 * Map a public route to the `index.html` output path under `distRoot`.
 * @param {string} distRoot Absolute path to the build output directory.
 * @param {string} route Public route path.
 * @returns {string}
 */
export function outputPathForRoute(distRoot: string, route: string): string;
/**
 * A discovered page route: the source file and its public route path.
 */
export type Route = {
    /**
     * Absolute path to the source `.md`/`.wd` file.
     */
    file: string;
    /**
     * Public route path (always trailing-slashed, e.g. `/about/`).
     */
    route: string;
};
