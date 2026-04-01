import type { VercelRequest, VercelResponse } from "@vercel/node";
import jwt from "jsonwebtoken";
import { getUserIdFromRequest, normalizeSupabaseJwtSecret } from "./_lib/auth";
import { applyCors } from "./_lib/http";

function peekJwtAlg(token: string): string | undefined {
  try {
    const d = jwt.decode(token, { complete: true });
    return typeof d?.header?.alg === "string" ? d.header.alg : undefined;
  } catch {
    return undefined;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  applyCors(req, res);
  if ((req.method || "GET") === "OPTIONS") {
    return res.status(204).end();
  }

  const auth = req.headers.authorization ?? null;
  const hasBearer = typeof auth === "string" && auth.startsWith("Bearer ");
  const bearer = hasBearer ? auth.slice("Bearer ".length).trim() : "";
  const tokenAlg = bearer ? peekJwtAlg(bearer) : undefined;

  const jwtSecretNormalized = Boolean(normalizeSupabaseJwtSecret(process.env.SUPABASE_JWT_SECRET));
  let canResolveUser = false;
  if (hasBearer) {
    canResolveUser = (await getUserIdFromRequest(req)) !== null;
  }

  res.status(200).json({
    ok: true,
    service: "nextplay-prisma-api",
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.url ?? null,
    hasAuthHeader: hasBearer,
    auth: {
      tokenAlg: tokenAlg ?? null,
      /** Used only for HS256 tokens. RS256/ES256 use JWKS from the token `iss` claim. */
      jwtSecretNormalizedOk: jwtSecretNormalized,
      canResolveUser,
    },
    env: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasSupabaseJwtSecret: Boolean(process.env.SUPABASE_JWT_SECRET?.trim()),
      hasDirectUrl: Boolean(process.env.DIRECT_URL),
      nodeEnv: process.env.NODE_ENV ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
    },
  });
}
