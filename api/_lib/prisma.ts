import pkg from "@prisma/client";

const { PrismaClient } = pkg;

declare global {
  // eslint-disable-next-line no-var
  var __nextplayPrisma: InstanceType<typeof PrismaClient> | undefined;
}

export const prisma =
  global.__nextplayPrisma ??
  new PrismaClient({
    log: ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__nextplayPrisma = prisma;
}
