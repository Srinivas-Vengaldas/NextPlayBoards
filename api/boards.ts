import type { VercelRequest, VercelResponse } from "@vercel/node";
import catchAll from "./[...path]";

function pathnameOnly(raw: string): string {
  if (!raw) return "";
  const noQuery = raw.includes("?") ? raw.slice(0, raw.indexOf("?")) : raw;
  try {
    return new URL(noQuery, "https://nextplay.invalid").pathname;
  } catch {
    return noQuery.startsWith("/") ? noQuery : `/${noQuery}`;
  }
}

/**
 * Explicit `/api/boards` entry so GET/POST are not lost when catch-all path metadata is incomplete on Vercel.
 * Only normalize `req.url` for the bare list/create path — never strip `/boards/:id/...` if this file receives nested routes.
 */
export default async function boardsRoute(req: VercelRequest, res: VercelResponse) {
  const raw = req.url ?? "";
  const search = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const path = pathnameOnly(raw);
  if (/^\/api\/boards\/?$/.test(path)) {
    req.url = `/api/boards${search}`;
  }
  return catchAll(req, res);
}
