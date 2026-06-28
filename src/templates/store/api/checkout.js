// Demo checkout endpoint. A plain Web-standard `(request) => Response` handler:
// it runs in `darkmown dev` and on Vercel Edge / Cloudflare Pages with no extra
// config. Echoes the order back with an id — swap in your real payment and
// fulfilment logic here (validate input, charge, write to a DB, send email).
export const config = { runtime: "edge" };

export default async function (request) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "POST only" }, { status: 405 });
  }
  const order = Object.fromEntries(await request.formData());
  return Response.json({
    ok: true,
    received: order,
    orderId: `ORD-${Date.now().toString(36).toUpperCase()}`,
    at: new Date().toISOString()
  });
}
