import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __nextplayPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__nextplayPrisma ??
  new PrismaClient({
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__nextplayPrisma = prisma;
}
