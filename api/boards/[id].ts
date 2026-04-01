import type { VercelRequest, VercelResponse } from "@vercel/node";
import catchAll from "../[...path]";

/**
 * Vercel platform routing can fail to match `api/[...path].ts` for nested segments on some setups.
 * Provide an explicit dynamic route for `/api/boards/:id` and delegate to the catch-all handler.
 */
export default async function boardIdRoute(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id ?? "");
  const raw = req.url ?? "";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/boards/${encodeURIComponent(id)}${search}`;
  return catchAll(req, res);
}

