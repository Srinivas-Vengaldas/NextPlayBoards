/**
 * Loads env from the repository root (Prisma does not read apps/web/.env).
 */
const { resolve } = require("node:path");
const { existsSync } = require("node:fs");
const { spawnSync } = require("node:child_process");

const root = resolve(__dirname, "..");
require("dotenv").config({ path: resolve(root, ".env") });
require("dotenv").config({ path: resolve(root, ".env.local"), override: true });

if (!process.env.DATABASE_URL?.trim()) {
  console.error("\nPrisma needs DATABASE_URL in a file at the repository root:\n");
  console.error("  " + resolve(root, ".env") + "\n");
  if (!existsSync(resolve(root, ".env"))) {
    console.error("That file is missing. Create it from the example:\n");
    console.error("  cp .env.example .env\n");
  } else {
    console.error(".env exists but DATABASE_URL is empty or missing.\n");
  }
  console.error("(apps/web/.env is only for Vite — put the Postgres URI in the root .env for Prisma.)\n");
  process.exit(1);
}

const result = spawnSync("pnpm", ["exec", "prisma", "db", "push"], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(result.status === null ? 1 : result.status);
