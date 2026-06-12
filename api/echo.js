// Demo endpoint for the darkmown.com data page: echoes urlencoded form posts
// back as JSON. This is part of the demo site deployment, not the framework —
// Darkmown itself owns no server.
export default function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  res.status(200).json({
    ok: true,
    received: req.body ?? {},
    at: new Date().toISOString()
  });
}
