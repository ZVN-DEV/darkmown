// Demo metrics endpoint. A plain Web-standard `(request) => Response` handler:
// it runs in `darkmown dev` and on Vercel Edge / Cloudflare Pages with no extra
// config. Returns a snapshot of stats — replace the body with a real query
// (database, analytics API, billing provider, …).
export const config = { runtime: "edge" };

export default function () {
  return Response.json({
    revenue: 48230,
    orders: 312,
    visitors: 8940,
    conversion: 3.5,
    updatedAt: new Date().toISOString()
  });
}
