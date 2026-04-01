import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Runs Prisma work in a transaction with Supabase-compatible JWT context so `auth.uid()` RLS policies apply.
 * Uses transaction-local `set_config` (required for PgBouncer transaction pooling on port 6543).
 */
export async function runWithRls<T>(userId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('request.jwt.claim.sub', ${userId}::text, true)`;
    return fn(tx);
  });
}
