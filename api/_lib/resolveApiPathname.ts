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

/**
 * Removes a leading `/api` segment (and repeats) so router paths are always like `/boards/...`,
 * never `/api/boards/...`. Always returns a path with a leading slash (or `/`).
 */
export function stripApiPrefix(pathWithApi: string): string {
  let s = pathWithApi.trim().replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  while (s.startsWith("/api")) {
    if (s === "/api" || s === "/api/") {
      s = "/";
    } else {
      s = s.slice(4);
      if (s !== "/" && !s.startsWith("/")) {
        s = `/${s}`;
      }
    }
  }
  return s || "/";
}

export function normalizeApiPath(p: string): string {
  let s = p.trim().replace(/\/+/g, "/");
  if (!s.startsWith("/")) s = `/${s}`;
  if (s.length > 1) {
    s = s.replace(/\/+$/, "");
  }
  return s || "/";
}

export function resolveApiPathname(req: VercelRequest): string {
  return resolveApiPathnameDebug(req).final;
}

export function resolveApiPathnameDebug(req: VercelRequest): { fromUrl: string; fromQuery: string; final: string } {
  const q = req.query?.path;
  const parts: string[] = Array.isArray(q) ? q.map(String) : q != null && String(q) !== "" ? [String(q)] : [];
  const fromQuery = parts.length > 0 ? normalizeApiPath("/" + parts.join("/")) : "";

  let fromUrl = "";
  const raw = req.url;
  if (raw != null && raw !== "") {
    try {
      const pathnameOnly = new URL(raw, "https://nextplay.invalid").pathname;
      fromUrl = normalizeApiPath(stripApiPrefix(pathnameOnly));
    } catch {
      const p = raw.startsWith("/") ? raw : `/${raw}`;
      const qIdx = p.indexOf("?");
      const pathPart = qIdx >= 0 ? p.slice(0, qIdx) : p;
      fromUrl = normalizeApiPath(stripApiPrefix(pathPart));
    }
  }

  const countQuery = pathSegmentCount(fromQuery);
  const countUrl = pathSegmentCount(fromUrl);

  let merged = "";
  if (fromQuery && fromUrl) {
    merged = countUrl >= countQuery ? fromUrl : fromQuery;
  } else {
    merged = fromUrl || fromQuery || "/";
  }

  const final = normalizeApiPath(stripApiPrefix(normalizeApiPath(merged)));
  return { fromUrl, fromQuery, final };
}
