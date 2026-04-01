import type { VercelRequest, VercelResponse } from "@vercel/node";

function parseAllowedOrigins(): string[] | null {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/**
 * Cross-origin browser calls (web on one Vercel URL, API on another) require
 * these headers on the response and on OPTIONS preflight.
 * If CORS_ORIGINS is unset, the request Origin is echoed when present (else *).
 * If set, only listed origins are allowed (comma-separated).
 */
export function applyCors(req: VercelRequest, res: VercelResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  const allowed = parseAllowedOrigins();
  let allow: string | undefined;
  if (allowed === null || allowed.length === 0) {
    allow = origin ?? "*";
  } else if (origin && allowed.includes(origin)) {
    allow = origin;
  } else if (allowed.includes("*")) {
    allow = "*";
  }
  if (allow) {
    res.setHeader("Access-Control-Allow-Origin", allow);
    if (allow !== "*") {
      res.setHeader("Vary", "Origin");
    }
  }
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Accept");
  res.setHeader("Access-Control-Max-Age", "86400");
}

export function sendJson(res: VercelResponse, status: number, payload: unknown) {
  // Prevent browsers/CDNs from returning 304 without a body.
  // Your frontend throws on any non-2xx, so a 304 breaks data loading.
  res
    .status(status)
    .setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store, max-age=0, must-revalidate")
    .setHeader("Pragma", "no-cache")
    .send(JSON.stringify(payload));
}

export function sendError(res: VercelResponse, status: number, message: string) {
  sendJson(res, status, { error: message });
}

export async function readBody<T>(reqBody: unknown): Promise<T> {
  if (reqBody && typeof reqBody === "object") {
    return reqBody as T;
  }
  return {} as T;
}

export function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
