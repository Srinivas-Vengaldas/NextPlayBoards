import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = req.headers.authorization ?? null;
  const hasBearer = typeof auth === "string" && auth.startsWith("Bearer ");

  res.status(200).json({
    ok: true,
    service: "nextplay-prisma-api",
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.url ?? null,
    hasAuthHeader: hasBearer,
    env: {
      hasDatabaseUrl: Boolean(process.env.DATABASE_URL),
      hasSupabaseJwtSecret: Boolean(process.env.SUPABASE_JWT_SECRET),
      hasDirectUrl: Boolean(process.env.DIRECT_URL),
      nodeEnv: process.env.NODE_ENV ?? null,
      vercelEnv: process.env.VERCEL_ENV ?? null,
    },
  });
}
