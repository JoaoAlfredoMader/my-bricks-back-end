import "dotenv/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

/** Uploaded files of the tests; removed by the global setup when the run ends. */
export const TEST_STORAGE_DIR = join(tmpdir(), "mybricks-test-storage");

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
      STORAGE_DRIVER: "local",
      STORAGE_DIR: TEST_STORAGE_DIR,
      // Small on purpose, so the "too large" scenarios do not need big buffers.
      MAX_UPLOAD_MB: "1",
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "test-only-secret-test-only-secret-0123456789",
    },
    // The scenario files share one database, so they run one after the other.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
