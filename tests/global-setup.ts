import { execSync } from "node:child_process";
import pg from "pg";
import type { TestProject } from "vitest/node";

/**
 * Prepares the test database once per run: creates it when missing, applies the migrations and
 * seeds the reference data (both are idempotent).
 */
export default async function setup(project: TestProject): Promise<void> {
  const databaseUrl = project.config.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set for the tests");

  const url = new URL(databaseUrl);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`Refusing to run the tests against "${name}": the database name must end with _test`);
  }

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    const exists = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: databaseUrl };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" });
  execSync("npx tsx prisma/seed/index.ts", { env, stdio: "pipe" });
}
