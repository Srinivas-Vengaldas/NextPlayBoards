import type { VercelRequest } from "@vercel/node";

/**
 * Vercel `api/[...path].ts` may set `req.query.path` to a single segment (e.g. `"boards"`)
 * even when the request URL is `/api/boards/<uuid>`. Prefer the pathname derived from `req.url`
 * when it is strictly more specific (more path segments) so GET /api/boards/:id matches the board handler.
 */
function pathSegmentCount(p: string): number {
  if (!p || p === "/") return 0;
  return p.split("/").filter(Boolean).length;
}

export function resolveApiPathname(req: VercelRequest): string {
  const q = req.query?.path;
  const parts: string[] = Array.isArray(q) ? q.map(String) : q != null && String(q) !== "" ? [String(q)] : [];
  const fromQuery = parts.length > 0 ? normalizeApiPath("/" + parts.join("/")) : "";

  let fromUrl = "";
  const raw = req.url;
  if (raw != null && raw !== "") {
    try {
      const pathname = new URL(raw, "https://nextplay.invalid").pathname;
      fromUrl = normalizeApiPath(stripApiPrefix(pathname));
    } catch {
      const p = raw.startsWith("/") ? raw : `/${raw}`;
      fromUrl = normalizeApiPath(stripApiPrefix(p));
    }
  }

  const countQuery = pathSegmentCount(fromQuery);
  const countUrl = pathSegmentCount(fromUrl);

  if (fromQuery && fromUrl) {
    return countUrl >= countQuery ? fromUrl : fromQuery;
  }
  return fromUrl || fromQuery || "/";
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
