// Demo endpoint for the darkmown.com data page: echoes a form/JSON POST back as
// JSON. Part of the demo-site deployment, not the framework — Darkmown owns no
// server. This is the blessed convention: a Web-standard `(request) => Response`
// handler that runs identically in `darkmown dev`, on Vercel Edge, and on
// Cloudflare Pages. On Vercel the edge config opts into the Web signature.
export const config = { runtime: "edge" };

export default async function (request) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "POST only" }, { status: 405 });
  }
  return Response.json({
    ok: true,
    received: await readBody(request),
    at: new Date().toISOString()
  });
}

/**
 * Parse a request body as JSON or form data (urlencoded / multipart), so the
 * same endpoint serves both a native `:form` POST and a JSON `:fetch`.
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form);
}
