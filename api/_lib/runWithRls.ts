import { prisma } from "./prisma";

/**
 * Runs Prisma work in a transaction with Supabase-compatible JWT context so `auth.uid()` RLS policies apply.
 * Uses transaction-local `set_config` (required for PgBouncer transaction pooling on port 6543).
 *
 * The callback `tx` is Prisma's interactive transaction client. We use `any` here (not `import type` from
 * `@prisma/client`) because Vercel's API TypeScript pass can report TS2305 on generated client type exports
 * even after `prisma generate`.
 */
export async function runWithRls<T>(userId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT set_config('request.jwt.claim.sub', $1::text, true)", userId);
    return fn(tx);
  });
}
