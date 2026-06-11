import fs from "node:fs";
import path from "node:path";

export function serve(distRoot, url, res) {
  const file = resolvePublicFile(distRoot, url || "/");
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404, { "content-type": "text/html" });
    res.end("<h1>Not found</h1><p>This route is hidden or has not been created.</p>");
    return;
  }
  res.writeHead(200, { "content-type": contentType(file) });
  fs.createReadStream(file).pipe(res);
}

export function resolvePublicFile(distRoot, url) {
  const cleanUrl = decodeURIComponent(url.split("?")[0]);
  const base = cleanUrl.startsWith("/__wd/")
    ? cleanUrl
    : path.join(cleanUrl, path.extname(cleanUrl) ? "" : "index.html");
  const requested = path.resolve(distRoot, `.${base}`);
  const root = path.resolve(distRoot);
  if (requested !== root && !requested.startsWith(`${root}${path.sep}`)) return null;
  return requested;
}

export function contentType(file) {
  if (file.endsWith(".css")) return "text/css";
  if (file.endsWith(".js")) return "text/javascript";
  if (file.endsWith(".json")) return "application/json";
  return "text/html";
}
