// Demo endpoint for the darkmown.com upload and error-body pages. Accepts a
// multipart POST and echoes what it received; refuses anything without a file
// with a 422 whose JSON body carries BOTH a top-level `error` string and a
// per-field map, which is the shape `<name>_error` / `<name>_error_body` are
// built to render.
//
// Part of the demo-site deployment, not the framework. Web-standard
// `(request) => Response`, so it runs identically under `darkmown dev`, on
// Vercel Edge, and on Cloudflare Pages.
export const config = { runtime: "edge" };

const LIMIT = 2 * 1024 * 1024;

export default async function (request) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Send a POST with a file.", fields: {} },
      { status: 405 }
    );
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return Response.json(
      { error: "That body was not a form.", fields: {} },
      { status: 400 }
    );
  }

  const file = form.get("photo");
  if (!file || typeof file === "string") {
    return Response.json(
      { error: "Pick a file first.", fields: { photo: "No file was attached." } },
      { status: 422 }
    );
  }
  if (file.size > LIMIT) {
    return Response.json(
      {
        error: "That file is too large.",
        fields: { photo: `${(file.size / 1024 / 1024).toFixed(1)} MB is over the 2 MB limit.` }
      },
      { status: 422 }
    );
  }

  return Response.json({
    name: file.name,
    size: file.size,
    type: file.type || "unknown",
    caption: form.get("caption") || "",
    at: new Date().toISOString()
  });
}
