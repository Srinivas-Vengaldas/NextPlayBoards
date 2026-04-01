import * as PrismaPkg from "@prisma/client";

const PrismaClient =
  (PrismaPkg as any).PrismaClient ?? (PrismaPkg as any).default?.PrismaClient;

if (!PrismaClient) {
  throw new Error("PrismaClient export not found in @prisma/client");
}

declare global {
  // eslint-disable-next-line no-var
  var __nextplayPrisma: any | undefined;
}

export const prisma =
  globalThis.__nextplayPrisma ??
  new PrismaClient({
    log: ["error"],
  });

globalThis.__nextplayPrisma = prisma;
