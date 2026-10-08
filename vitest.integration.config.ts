import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

// Runs the real actions and queries against a real PostgreSQL. It uses the test database only
// (E2E_DATABASE_URL), never DATABASE_URL, so a developer's own data can't be touched.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    setupFiles: ["tests/integration/setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://localhost:5432/dayboard_test",
      BETTER_AUTH_SECRET: "integration-tests-only-secret-0123456789abcdef",
      BETTER_AUTH_URL: "http://localhost:3000",
      NEXT_PUBLIC_APP_URL: "http://localhost:3000",
      // Files (feature 09): the in-memory store, and a 1 MB allowance per person so a quota is easy
      // to reach with small files.
      STORAGE_DRIVER: "memory",
      STORAGE_QUOTA_MB: "1",
    },
  },
});
