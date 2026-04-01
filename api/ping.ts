import type { VercelRequest, VercelResponse } from "@vercel/node";

/** Minimal route to verify Vercel deployed Node functions (`GET /api/ping` → JSON, not platform NOT_FOUND). */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).setHeader("Content-Type", "application/json").send(JSON.stringify({ ok: true }));
}
