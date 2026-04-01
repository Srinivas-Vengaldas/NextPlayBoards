import type { VercelRequest } from "@vercel/node";
import jwt from "jsonwebtoken";

/**
 * Vercel / pasted env vars often include wrapping quotes or trailing newlines.
 * Supabase dashboard → Settings → API → JWT Secret (not the anon/service role keys).
 */
export function normalizeSupabaseJwtSecret(raw: string | undefined): string | null {
  if (raw == null || raw === "") return null;
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.length > 0 ? s : null;
}

const verifyOpts: jwt.VerifyOptions = {
  algorithms: ["HS256"],
  clockTolerance: 300,
};

/**
 * Try UTF-8 secret (typical), then HMAC key decoded from base64 (some setups store key as base64).
 */
function verifySupabaseAccessToken(token: string, secretUtf8: string): jwt.JwtPayload {
  try {
    return jwt.verify(token, secretUtf8, verifyOpts) as jwt.JwtPayload;
  } catch (e1) {
    try {
      const key = Buffer.from(secretUtf8, "base64");
      if (key.length === 0) throw e1;
      return jwt.verify(token, key, verifyOpts) as jwt.JwtPayload;
    } catch {
      throw e1;
    }
  }
}

/**
 * Supabase session `access_token` is HS256 with the project JWT secret.
 * Uses `jsonwebtoken` (CJS-friendly on Vercel); never import ESM-only `jose` here.
 */
export async function getUserIdFromRequest(req: VercelRequest): Promise<string | null> {
  const auth = req.headers.authorization;
  const rawSecretEnv = process.env.SUPABASE_JWT_SECRET;
  const secret = normalizeSupabaseJwtSecret(rawSecretEnv);

  const hasAuthHeader = Boolean(auth);
  const bearerSchemeOk = typeof auth === "string" && auth.toLowerCase().startsWith("bearer ");
  const secretConfigured = Boolean(secret);

  if (!auth || !auth.startsWith("Bearer ")) {
    console.warn("[auth] 401", {
      reason: "missing_or_invalid_authorization_scheme",
      hasAuthHeader,
      bearerSchemeOk,
      secretConfigured,
      secretEnvLength: rawSecretEnv?.trim()?.length ?? 0,
    });
    return null;
  }

  const token = auth.slice("Bearer ".length).trim();
  if (!token) {
    console.warn("[auth] 401", { reason: "empty_bearer_token", secretConfigured });
    return null;
  }

  if (!secret) {
    console.warn("[auth] 401", {
      reason: "supabase_jwt_secret_missing_after_normalize",
      hadRawEnv: Boolean(rawSecretEnv?.trim()),
    });
    return null;
  }

  try {
    const payload = verifySupabaseAccessToken(token, secret);
    const sub = payload.sub;
    if (!sub || typeof sub !== "string") {
      console.warn("[auth] 401", { reason: "jwt_missing_sub", hasPayload: Boolean(payload) });
      return null;
    }
    return sub;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn("[auth] 401", {
      reason: "jwt_verify_failed",
      errorName: err.name,
      errorMessage: err.message,
      tokenLength: token.length,
      secretLength: secret.length,
    });
    return null;
  }
}
