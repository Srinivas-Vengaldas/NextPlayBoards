import type { VercelRequest, VercelResponse } from "@vercel/node";
import catchAll from "../../[...path]";

/**
 * Explicit dynamic sub-route for `/api/columns/:id/*` (e.g. tasks).
 * Delegates to the root catch-all so auth/RLS logic remains centralized.
 */
export default async function columnIdSubRoute(req: VercelRequest, res: VercelResponse) {
  const id = String(req.query.id ?? "");
  const restQ = req.query.rest;
  const restParts = Array.isArray(restQ) ? restQ.map(String) : restQ != null ? [String(restQ)] : [];

  const raw = req.url ?? "";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const restPath = restParts.length > 0 ? `/${restParts.map(encodeURIComponent).join("/")}` : "";

  req.url = `/api/columns/${encodeURIComponent(id)}${restPath}${search}`;
  return catchAll(req, res);
}

