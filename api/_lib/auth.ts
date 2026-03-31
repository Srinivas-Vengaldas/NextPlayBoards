import type { VercelRequest } from "@vercel/node";
import { jwtVerify } from "jose";

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
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret));
    const sub = payload.sub;
    if (!sub || typeof sub !== "string") return null;
    return sub;
  } catch {
    return null;
  }
}
