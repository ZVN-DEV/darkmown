/**
 * Resolved project paths used across the build pipeline.
 * @typedef {object} Paths
 * @property {string} cwd Project working directory.
 * @property {string} routesRoot Absolute path to `site/pages`.
 * @property {string} shelfRoot Absolute path to the include shelf `site/_`.
 * @property {string} distRoot Absolute path to the build output `dist`.
 */
/**
 * Build the absolute project paths for a given working directory.
 * @param {string} [cwd] Project working directory (defaults to `process.cwd()`).
 * @returns {Paths}
 */
export function createPaths(cwd?: string): Paths;
/**
 * Whether a file or directory name is hidden from routing (starts with `.`, `-`, or `_`).
 * @param {string} name
 * @returns {boolean}
 */
export function isHiddenName(name: string): boolean;
export const routesDir: "site/pages";
export const shelfDir: "site/_";
export const distDir: "dist";
export const pageExtensions: Set<string>;
/**
 * Resolved project paths used across the build pipeline.
 */
export type Paths = {
    /**
     * Project working directory.
     */
    cwd: string;
    /**
     * Absolute path to `site/pages`.
     */
    routesRoot: string;
    /**
     * Absolute path to the include shelf `site/_`.
     */
    shelfRoot: string;
    /**
     * Absolute path to the build output `dist`.
     */
    distRoot: string;
};
