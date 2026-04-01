import type { VercelRequest } from "@vercel/node";

/**
 * Vercel `api/[...path].ts` often exposes segments via `req.query.path` instead of a full `req.url` pathname.
 * Normalize to a path like `/boards` (no `/api` prefix, no trailing slash except `/`).
 */
export function resolveApiPathname(req: VercelRequest): string {
  const q = req.query?.path;
  const parts: string[] = Array.isArray(q) ? q.map(String) : q != null && String(q) !== "" ? [String(q)] : [];
  if (parts.length > 0) {
    return normalizeApiPath("/" + parts.join("/"));
  }

  const raw = req.url;
  if (raw == null || raw === "") {
    return "/";
  }

  try {
    const pathname = new URL(raw, "https://nextplay.invalid").pathname;
    return normalizeApiPath(stripApiPrefix(pathname));
  } catch {
    const p = raw.startsWith("/") ? raw : `/${raw}`;
    return normalizeApiPath(stripApiPrefix(p));
  }
}

function stripApiPrefix(pathWithApi: string): string {
  return pathWithApi.replace(/^\/api(\/|$)/, "/") || "/";
}

export function normalizeApiPath(p: string): string {
  let s = p.startsWith("/") ? p : `/${p}`;
  if (s.length > 1) {
    s = s.replace(/\/+$/, "");
  }
  return s || "/";
}
