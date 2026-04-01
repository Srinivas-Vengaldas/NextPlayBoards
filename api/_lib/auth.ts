import type { VercelRequest } from "@vercel/node";
import jwt from "jsonwebtoken";

/**
 * Supabase-issued access tokens use HS256 + `SUPABASE_JWT_SECRET`.
 * `jsonwebtoken` is CommonJS-friendly; `jose` is ESM-only and Vercel’s api bundle was emitting `require("jose")` → ERR_REQUIRE_ESM.
 */
export async function getUserIdFromRequest(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    return null;
  }
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return null;

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return null;
  }

  try {
    const payload = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    const sub = payload.sub;
    if (!sub || typeof sub !== "string") return null;
    return sub;
  } catch {
    return null;
  }
}
