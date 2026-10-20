import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL as baseURL, E2E_DATABASE_URL, E2E_PORT as PORT } from "./e2e/env";
import { fakeMicrophoneFile } from "./e2e/voice-audio";

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
      testIgnore: /(mobile|voice)\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel },
    },
    {
      // Voice capture (feature 13): Chromium with a fake microphone that plays a file and says yes to the
      // permission prompt, so a recording needs no person and no real device.
      name: "voice",
      testMatch: /voice\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        channel,
        permissions: ["microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            `--use-file-for-fake-audio-capture=${fakeMicrophoneFile()}`,
          ],
        },
      },
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
      // Tick mode (feature 08) is how a test runs the background jobs, such as the search index (feature 10).
      JOBS_TICK_SECRET: "e2e-tick-secret-0123456789abcdefghijkl",
      // Calendar (feature 12): the mock provider, never Google, and a fixed test key (32 bytes, base64).
      CALENDAR_PROVIDER: "mock",
      PUSH_PROVIDER: "mock",
      VAPID_PUBLIC_KEY: "",
      VAPID_PRIVATE_KEY: "",
      VAPID_SUBJECT: "",
      GOOGLE_CALENDAR_CLIENT_ID: "",
      GOOGLE_CALENDAR_CLIENT_SECRET: "",
      GOOGLE_CALENDAR_REDIRECT_URI: "",
      TOKEN_ENCRYPTION_KEY: "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLTEyMzQ=",
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
      // A test seam (V3 feature 01): a canvas page exposes its drawing as `window.__canvasApi`, so a test can find a box.
      NEXT_PUBLIC_E2E: "1",
    },
  },
});
