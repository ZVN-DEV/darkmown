import path from "node:path";

export const routesDir = "site/pages";
export const shelfDir = "site/_";
export const distDir = "dist";
export const pageExtensions = new Set([".md", ".wd"]);

export function createPaths(cwd = process.cwd()) {
  return {
    cwd,
    routesRoot: path.join(cwd, routesDir),
    shelfRoot: path.join(cwd, shelfDir),
    distRoot: path.join(cwd, distDir)
  };
}

export function isHiddenName(name) {
  return name.startsWith(".") || name.startsWith("-") || name.startsWith("_");
}
