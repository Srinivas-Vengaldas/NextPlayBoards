import type { VercelRequest, VercelResponse } from "@vercel/node";
import catchAll from "../[...path]";

/**
 * Explicit dynamic route for `/api/columns/:id` delegating to the catch-all handler.
 * Helps avoid Vercel platform `NOT_FOUND` on some deployments.
 */
export default async function columnIdRoute(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id ?? "");
  const raw = req.url ?? "";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/columns/${encodeURIComponent(id)}${search}`;
  return catchAll(req, res);
}

