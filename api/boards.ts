import type { VercelRequest, VercelResponse } from "@vercel/node";
import catchAll from "./[...path]";

/**
 * Explicit `/api/boards` entry so GET/POST are not lost when catch-all path metadata is incomplete on Vercel.
 */
export default async function boardsRoute(req: VercelRequest, res: VercelResponse) {
  const raw = req.url ?? "";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  req.url = `/api/boards${search}`;
  return catchAll(req, res);
}
