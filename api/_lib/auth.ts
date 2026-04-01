import type { VercelRequest } from "@vercel/node";
import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

/**
 * Vercel / pasted env vars often include wrapping quotes or trailing newlines.
 * For HS256 tokens: Supabase → Settings → API → JWT Secret (not anon/service keys).
 * For RS256/ES256: Supabase signs with a keypair; verify via JWKS (no symmetric secret).
 */
export function normalizeSupabaseJwtSecret(raw: string | undefined): string | null {
  if (raw == null || raw === "") return null;
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s.length > 0 ? s : null;
}

const clockToleranceSec = 300;

const hs256Opts: jwt.VerifyOptions = {
  algorithms: ["HS256"],
  clockTolerance: clockToleranceSec,
};

/**
 * Symmetric Supabase access tokens (legacy / some projects).
 */
function verifySupabaseAccessTokenHs256(token: string, secretUtf8: string): jwt.JwtPayload {
  try {
    return jwt.verify(token, secretUtf8, hs256Opts) as jwt.JwtPayload;
  } catch (e1) {
    try {
      const key = Buffer.from(secretUtf8, "base64");
      if (key.length === 0) throw e1;
      return jwt.verify(token, key, hs256Opts) as jwt.JwtPayload;
    } catch {
      throw e1;
    }
  }
}

/**
 * Asymmetric tokens (e.g. ES256) — JWKS at `{iss}/.well-known/jwks.json`.
 */
async function verifySupabaseJwtWithJwks(token: string, alg: "RS256" | "ES256", kid: string, iss: string): Promise<jwt.JwtPayload> {
  const jwksUri = `${iss.replace(/\/$/, "")}/.well-known/jwks.json`;
  const client = jwksRsa({
    jwksUri,
    cache: true,
    cacheMaxAge: 600_000,
    rateLimit: true,
    jwksRequestsPerMinute: 30,
  });
  const signingKey = await client.getSigningKey(kid);
  const pubKey = signingKey.getPublicKey();
  return jwt.verify(token, pubKey, {
    algorithms: [alg],
    clockTolerance: clockToleranceSec,
  }) as jwt.JwtPayload;
}

/** Read JWT header `alg` (Supabase may use HS256, RS256, or ES256). */
function getJwtAlgorithm(token: string): string | null {
  const complete = jwt.decode(token, { complete: true });
  const alg = complete?.header?.alg;
  return typeof alg === "string" ? alg : null;
}

/**
 * Verifies Supabase-issued access_token and returns `sub` (user id).
 * Uses `jsonwebtoken` + `jwks-rsa` (CJS-friendly on Vercel).
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

  const headerAlg = getJwtAlgorithm(token);
  if (!headerAlg) {
    console.warn("[auth] 401", { reason: "jwt_decode_or_missing_alg" });
    return null;
  }

  const algNorm = headerAlg.toUpperCase();

  try {
    let payload: jwt.JwtPayload;

    if (algNorm === "HS256") {
      if (!secret) {
        console.warn("[auth] 401", {
          reason: "hs256_requires_supabase_jwt_secret",
          hadRawEnv: Boolean(rawSecretEnv?.trim()),
        });
        return null;
      }
      payload = verifySupabaseAccessTokenHs256(token, secret);
    } else if (algNorm === "RS256" || algNorm === "ES256") {
      const complete = jwt.decode(token, { complete: true });
      const kid = complete?.header?.kid;
      const iss = (complete?.payload as jwt.JwtPayload | undefined)?.iss;
      if (typeof kid !== "string" || !kid) {
        console.warn("[auth] 401", { reason: "asymmetric_jwt_missing_kid", alg: algNorm });
        return null;
      }
      if (typeof iss !== "string" || !iss.startsWith("https://")) {
        console.warn("[auth] 401", { reason: "asymmetric_jwt_missing_iss", alg: algNorm });
        return null;
      }
      payload = await verifySupabaseJwtWithJwks(token, algNorm, kid, iss);
    } else {
      console.warn("[auth] 401", { reason: "unsupported_jwt_alg", alg: headerAlg });
      return null;
    }

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
      jwtAlg: headerAlg,
      secretLength: secret?.length ?? 0,
    });
    return null;
  }
}
