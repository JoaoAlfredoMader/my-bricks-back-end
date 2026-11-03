import "dotenv/config";
import { defineConfig } from "vitest/config";

/**
 * Tests run against their own database (`<name>_test` on the same server), never against the
 * development one: the scenarios truncate the auth tables.
 */
function testDatabaseUrl(): string {
  const source = process.env.DATABASE_URL ?? "postgresql://mybricks:mybricks@localhost:5433/mybricks?schema=public";
  const url = new URL(source);
  const name = url.pathname.slice(1);
  if (!name.endsWith("_test")) url.pathname = `/${name}_test`;
  return url.toString();
}

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: testDatabaseUrl(),
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-only-secret-test-only-secret-0123456789",
    },
    // The scenario files share one database, so they run one after the other.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
