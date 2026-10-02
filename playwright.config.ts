import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL as baseURL, E2E_DATABASE_URL, E2E_PORT as PORT } from "./e2e/env";

// Locally, use the installed Google Chrome so no extra browser download is needed. CI installs
// Playwright's own Chromium (`playwright install --with-deps chromium`).
const channel = process.env.CI ? undefined : "chrome";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  // Many browsers run at once, which can starve animations (a closing dialog) for a few seconds,
  // and a test that signs up two people spends most of its time on the two sign-ups.
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    // Dates ("today", "overdue") depend on the person's time zone; tests pin it so they are the same everywhere.
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 7"], channel },
    },
  ],
  webServer: {
    // Applies migrations to the test database, builds, and serves the production build.
    command: `pnpm db:migrate && pnpm build && pnpm start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    env: {
      // Its own build folder, so a test run never disturbs a developer's running `next dev`.
      NEXT_DIST_DIR: ".next-e2e",
      E2E: "true",
      // Tests never depend on a developer's own .env.local: sign-in providers stay off.
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      // CI and local runs never reach a real AI provider: always the mock, with no key at all.
      AI_PROVIDER: "mock",
      AI_API_KEY: "",
      AI_MOCK_MODE: "",
      AI_LIMIT_PER_MINUTE: "10",
      AI_LIMIT_PER_DAY: "100",
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
