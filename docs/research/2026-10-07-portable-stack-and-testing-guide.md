# Dayboard's stack and testing setup, for reuse in another project

**Date:** 2026-10-07
**Status:** Reference. Describes the repo as it is today. No code changed.
**Purpose:** Everything needed to recreate Dayboard's stack and its four-layer test setup in a new project: what to install, which config files to copy, the patterns that make the tests work, and the traps already hit.

**How it was made:** from `package.json`, every config file, and the actual harness files (`tests/integration/*`, `e2e/helpers.ts`, `e2e/db.ts`, `e2e/mailbox.ts`, `e2e/fixtures.ts`). Code below is copied from the repo, not paraphrased. For what each library does in depth, see [2026-10-04-tech-stack-explained.md](2026-10-04-tech-stack-explained.md).

## Contents

1. [The stack in one table](#1-the-stack-in-one-table)
2. [Testing at a glance](#2-testing-at-a-glance)
3. [Layer 1: unit tests (Vitest)](#3-layer-1-unit-tests-vitest)
4. [Layer 2: integration tests (Vitest + real PostgreSQL)](#4-layer-2-integration-tests-vitest--real-postgresql)
5. [Layer 3: end-to-end tests (Playwright)](#5-layer-3-end-to-end-tests-playwright)
6. [Layer 4: quality gates beyond tests](#6-layer-4-quality-gates-beyond-tests)
7. [The mock AI provider](#7-the-mock-ai-provider)
8. [Project scripts and the commands to run](#8-project-scripts-and-the-commands-to-run)
9. [Setting this up in a new project](#9-setting-this-up-in-a-new-project)
10. [Traps already hit](#10-traps-already-hit)
11. [What is not set up](#11-what-is-not-set-up)

---

## 1. The stack in one table

Versions are exactly those in `package.json` (a leading `^` means a range; everything else is pinned).

| Layer                      | Choice                                                                                                              | Version                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Runtime, packages          | Node.js, pnpm                                                                                                       | 24 LTS (`>=24 <25`), 10.26.2                   |
| Language                   | TypeScript (`strict`, `noUncheckedIndexedAccess`)                                                                   | 6.0.3                                          |
| Framework                  | Next.js (App Router, standalone output), React                                                                      | 16.3.8, 19.3.0                                 |
| Database                   | PostgreSQL, driver `postgres`, ORM `drizzle-orm`, migrations `drizzle-kit`                                          | 17 (Docker), 3.4.9, 0.45.3, 0.31.11            |
| Auth                       | `better-auth` + `@better-auth/drizzle-adapter`                                                                      | 1.7.7                                          |
| Email                      | `resend` behind an `EmailSender` interface                                                                          | 6.31.0                                         |
| Validation                 | `zod`                                                                                                               | 4.6.5                                          |
| AI                         | `ai` (Vercel AI SDK) + `@ai-sdk/anthropic` + `@ai-sdk/google`, behind a provider interface with a mock              | ^7.0.127, ^4.0.71, ^4.0.87                     |
| Styling                    | Tailwind CSS v4 (`@tailwindcss/postcss`), `tw-animate-css`                                                          | 4.3.3, 1.4.0                                   |
| UI                         | shadcn/ui pattern (copied source), `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react` | 1.6.7, 0.7.1, 2.1.1, 3.7.0, 1.49.0             |
| UI extras                  | `next-themes`, `sonner`, `cmdk`, `motion`, `frimousse`                                                              | 0.4.6, 2.0.8, 1.1.1, 14.0.0, 0.4.0             |
| Editor                     | Tiptap (react, pm, starter-kit, extension-list, placeholder, bubble-menu, table, suggestion)                        | 3.31.4                                         |
| Dates                      | `date-fns`, `@date-fns/tz`                                                                                          | 4.4.0, 1.5.0                                   |
| Font                       | `@fontsource-variable/inter` (self-hosted)                                                                          | ^5.3.0                                         |
| Guard                      | `server-only`                                                                                                       | 0.0.1                                          |
| Unit and integration tests | `vitest`                                                                                                            | 5.0.3                                          |
| End-to-end tests           | `@playwright/test`, `@axe-core/playwright`                                                                          | 1.63.0, 4.13.0                                 |
| Quality                    | ESLint + `eslint-config-next`, Prettier + `prettier-plugin-tailwindcss`, Husky, lint-staged                         | ^9.39.5 / 16.3.8, 3.9.9 / 0.8.1, 9.1.7, 17.6.0 |
| Script tools               | `tsx`, `esbuild`                                                                                                    | 4.23.15, 0.28.2                                |
| Delivery                   | Docker (multi-stage), Docker Compose                                                                                | n/a                                            |

Not every row belongs in every project. For a different app, the parts that carry over almost unchanged are: Node/pnpm/TypeScript, Vitest, Playwright + axe, Drizzle + postgres.js, Zod, Tailwind + shadcn pattern, ESLint/Prettier, and the Docker build.

---

## 2. Testing at a glance

Four layers, each catching a different kind of mistake. All run locally today; there is no CI yet (see [section 11](#11-what-is-not-set-up)).

| Layer         | Tool                                              | Where                | Files | Needs                                         | What it proves                                                                                                                |
| ------------- | ------------------------------------------------- | -------------------- | ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Unit          | Vitest                                            | `tests/unit/`        | 38    | nothing (plain Node)                          | Pure logic is right: dates, task rules, recurrence, validation, URL safety, search ranking, AI output parsing, theme contrast |
| Integration   | Vitest                                            | `tests/integration/` | 8     | a PostgreSQL test database                    | The real Server Actions, queries and constraints work together, and one person can't touch another's data                     |
| End to end    | Playwright                                        | `e2e/`               | 20    | a production build, the test database, Chrome | A person can actually do the thing in a browser, on desktop and phone, in light and dark                                      |
| Quality gates | axe, `theme:check`, bundle check, lint, typecheck | various              | n/a   | n/a                                           | Accessibility, color contrast, no secrets in the browser bundle, code style                                                   |

Rough size: about 725 `it`/`test` declarations in unit and integration files (some expand into more through `it.each` and loops), and about 267 `test(` declarations across the end-to-end files. These counts come from a text search, so treat them as approximate.

**The big design choices, in order of how much they matter:**

1. **The AI is never real in tests.** A mock provider returns fixed answers, forced on by `E2E=true` (and `AI_PROVIDER=mock`). Tests cost nothing, are deterministic and need no network.
2. **Email is never sent in tests.** In test runs the console sender appends every email (with its link) to `.e2e/emails.jsonl`, and Playwright reads verification and reset links from that file.
3. **Tests use their own database** (`dayboard_test`) and a separate `distDir` (`.next-e2e`) and port (3100), so they never touch development data or a running dev server.
4. **Integration tests run real code, mocking only the framework.** Only `requireUser`, `next/cache`, `next/headers` and `next/navigation` are faked; actions, mutations, queries and the database are real.
5. **End-to-end tests run against a production build**, not `next dev`, so they exercise what ships.

---

## 3. Layer 1: unit tests (Vitest)

**Config** (`vitest.config.ts`), copied as is:

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // `server-only` throws outside a React Server Components build. Tests run in plain Node.
      "server-only": path.resolve(root, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    clearMocks: true,
  },
});
```

`tests/stubs/server-only.ts` is one line: `export {};`.

**Patterns that make these tests good:**

- **Put rules in pure functions** (`src/lib/tasks/`, `src/lib/dates/`, `src/lib/search/`, `src/lib/redirects.ts`, `src/lib/theme/`) so they can be tested without a browser or a database. This is the main reason the unit layer is cheap and large.
- **Table-driven tests with `it.each`** for lists of cases, e.g. rejecting unsafe redirect targets:

  ```ts
  it.each([
    ["absolute URL", "https://evil.example/steal"],
    ["protocol-relative URL", "//evil.example"],
    ["javascript scheme", "javascript:alert(1)"],
    ["sign-in loop", "/sign-in"],
  ])("rejects %s", (_label, input) => {
    expect(safeNextPath(input)).toBe("/today");
  });
  ```

- **Mock at module boundaries with `vi.hoisted` + `vi.mock`**, then import the module under test afterwards (from `tests/unit/require-user.test.ts`):

  ```ts
  const mocks = vi.hoisted(() => ({
    getSession: vi.fn(),
    headers: vi.fn(),
    redirect: vi.fn((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    }),
  }));

  vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
  vi.mock("next/headers", () => ({ headers: mocks.headers }));
  vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

  import { requireUser } from "@/lib/session"; // imported after the mocks
  ```

- **Loops that generate one test per case**, so a failure names the exact pair. The theme contrast test creates one `it` per foreground/background color pair in both themes ("dark: text: foreground on background ≥ 4.5"), and also asserts that the shipped CSS equals what the generator would produce, so a hand-edited color fails the build.

Run: `pnpm test` (`vitest run`).

---

## 4. Layer 2: integration tests (Vitest + real PostgreSQL)

**Config** (`vitest.integration.config.ts`):

```ts
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
    },
  },
});
```

Notes:

- `fileParallelism: false` runs files one after another, since they share one database.
- The config overrides `DATABASE_URL` with the **test** database. A developer's `.env.local` can never be reached from this suite.
- The test database must already exist and be migrated (`createdb dayboard_test`, then migrate it).

**Setup file** (`tests/integration/setup.ts`). It fakes only the framework pieces that exist inside a running Next.js server:

```ts
import { vi } from "vitest";
import { AppError } from "@/lib/errors";

vi.mock("@/lib/session", () => ({
  requireUser: async () => {
    const user = (globalThis as { __testUser?: unknown }).__testUser;
    if (!user) throw new AppError("UNAUTHENTICATED");
    return user;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: () => {} }));
```

**Harness** (`tests/integration/harness.ts`). This is the most reusable piece. It gives tests real users and a way to "sign in" as them:

```ts
const created: string[] = [];

/** A real user row (with preferences), removed again when the file finishes. */
export async function createTestUser(label = "user"): Promise<TestUser> {
  const id = uuidv7();
  const email = `${label}-${id.slice(-12)}@integration.test`;
  await db.insert(user).values({ id, name: label, email, emailVerified: true });
  await db.insert(userPreferences).values({ userId: id, onboardedAt: new Date() });
  created.push(id);
  return { id, email, name: label /* …session fields… */ };
}

/** Makes the next action calls act as this person (or as nobody). */
export function actAs(person: TestUser | null) {
  (globalThis as { __testUser?: TestUser | null }).__testUser = person;
}

afterAll(async () => {
  actAs(null);
  if (created.length > 0) await db.delete(user).where(inArray(user.id, created)); // cascades
  await sql.end();
});

/** Unwraps an ActionResult, failing the test with the error if it wasn't ok. */
export function ok<T>(result: ActionResult<T>): T {
  /* throws with code and message */
}
export function errorOf(result): { code; message; fieldErrors? } {
  /* throws if it was ok */
}
```

**How a test reads** (from `tests/integration/todos.test.ts`):

```ts
let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-todos");
  bob = await createTestUser("bob-todos");
});

async function make(person: TestUser, input = {}) {
  actAs(person);
  return ok(await createTodo({ title: "A todo", ...input }));
}

it("only accepts a project that is the person's own", async () => {
  /* … */
});
it("requires a signed-in person", async () => {
  actAs(null);
  expect(errorOf(await createTodo({ title: "x" })).code).toBe("UNAUTHENTICATED");
});
```

**Why this works well:**

- **Real database, real constraints.** `CHECK` constraints, foreign keys, cascades and transactions are exercised, not mocked. One test even asserts that the database itself keeps `isComplete` and `completedAt` in step.
- **Ownership tests are a first-class habit.** Almost every feature has a test where `bob` tries to read, change or link `alice`'s record and must get "not found" or an error. In a multi-user app this is the highest-value test class.
- **Cleanup is automatic.** Each file creates its own users and deletes them in `afterAll`; cascading deletes remove their data. Tests don't depend on each other's rows.
- **Tests assert on the database directly** (`db.select().from(todos).where(...)`) as well as on action results.

Run: `pnpm test:integration`.

---

## 5. Layer 3: end-to-end tests (Playwright)

**Config** (`playwright.config.ts`), the key parts:

```ts
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
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL,
    timezoneId: "Asia/Kolkata", // pinned so "today" and "overdue" are the same everywhere
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], channel },
    },
    { name: "mobile", testMatch: /mobile\.spec\.ts/, use: { ...devices["Pixel 7"], channel } },
  ],
  webServer: {
    // Applies migrations to the test database, builds, and serves the production build.
    command: `pnpm db:migrate && pnpm build && pnpm start -p ${PORT}`,
    url: `${baseURL}/api/health`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    env: {
      NEXT_DIST_DIR: ".next-e2e", // its own build folder
      E2E: "true", // console email written to a file, mock AI forced on
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      GITHUB_CLIENT_ID: "",
      GITHUB_CLIENT_SECRET: "",
      AI_PROVIDER: "mock",
      AI_API_KEY: "",
      AI_MOCK_MODE: "",
      DATABASE_URL: E2E_DATABASE_URL,
      BETTER_AUTH_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
    },
  },
});
```

`e2e/env.ts` holds the port (3100) and the test database URL, and `next.config.ts` reads `NEXT_DIST_DIR` so the test build never disturbs a running `next dev`.

**The helper pieces to copy:**

- **`e2e/fixtures.ts`.** Every test gets its own fake client IP, so auth rate limits (keyed by IP) never collide when tests run in parallel against the real production limits:

  ```ts
  export const test = base.extend({
    extraHTTPHeaders: async ({}, use) => {
      await use({ "x-forwarded-for": fakeClientIp() });
    },
  });
  ```

- **`e2e/helpers.ts`.** `signUp(page)` fills the real sign-up form, waits for the verification email, follows its link and finishes onboarding. Tests create a brand-new user each time rather than sharing logins:

  ```ts
  const verification = await waitForEmail(account.email, "verify-email");
  await page.goto(verification.link);
  ```

  Also `signIn`, `signOut`, `uniqueEmail`, and `alertIn(scope)` (Next.js renders an empty `role="alert"` route announcer on every page, so a bare `getByRole("alert")` matches two elements).

- **`e2e/mailbox.ts`.** Polls `.e2e/emails.jsonl` for the next email to an address and template, with a timeout. `e2e/global-setup.ts` empties that file at the start of each run.

- **`e2e/db.ts`.** A direct `postgres` connection to the test database, with helpers like `findUser`, `rowCountsFor`, `ageSessions` (makes a session look older, to test "sign in again"), and `insertTask`, `insertNote`, `insertProject`... Tests use these to **set up specific states quickly** (a task due on a particular date) and to **assert what really happened to the data**, instead of clicking through the UI for everything.

**Specialised end-to-end suites:**

| File                     | What it does                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `a11y.spec.ts`           | Runs axe (WCAG 2 A and AA, 2.1 A and AA) on every signed-in and public screen, light and dark. Fails on any **serious or critical** violation, including color contrast                                                                                            |
| `reduced-motion.spec.ts` | With `prefers-reduced-motion`, samples each animated element's computed `transform`, `scale` and `translate` every frame for about 320 ms and asserts they never change. The same check with motion allowed must see movement, which proves the test isn't vacuous |
| `visual.spec.ts`         | Screenshot baselines (`toHaveScreenshot`, `animations: "disabled"`, `caret: "hide"`, `maxDiffPixelRatio: 0.01`) at 360, 768 and 1440 px in light and dark, with time-dependent text masked                                                                         |
| `responsive.spec.ts`     | Layout at 360, 390, 768, 1024, 1440 and 1920 px: no horizontal scroll, tap targets, the bottom nav not covering content                                                                                                                                            |
| `mobile.spec.ts`         | Runs under the Pixel 7 device profile                                                                                                                                                                                                                              |
| Feature specs            | `auth`, `tasks`, `todos`, `notes`, `projects`, `inbox`, `today`, `search`, `trash`, `settings`, `shell`, `ai`, `ai-writing`, `editor-blocks`, `clipboard`                                                                                                          |

**Habits worth keeping:**

- Select text with the keyboard (click, `End`, `Shift+Home`); repeated triple clicks are unreliable in the browser.
- Use accessible locators (`getByRole`, `getByLabel`) so tests double as a check that controls have names.
- Time-dependent behavior is controlled by pinning the time zone, and by masking or avoiding screens whose content depends on the clock.

Run: `pnpm test:e2e` (builds, migrates and serves automatically). Create the test database once first: `createdb dayboard_test`.

---

## 6. Layer 4: quality gates beyond tests

| Gate                   | Command                                                        | What it checks                                                                                                                                                                 |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Types                  | `pnpm typecheck`                                               | `tsc --noEmit` with `strict` and `noUncheckedIndexedAccess`                                                                                                                    |
| Lint                   | `pnpm lint`                                                    | ESLint with Next's `core-web-vitals` and TypeScript rule sets (includes React hooks and React compiler rules)                                                                  |
| Format                 | `pnpm format` (Prettier)                                       | 100 columns, double quotes, trailing commas, Tailwind class order                                                                                                              |
| Theme drift            | `pnpm theme:check`                                             | The generated colors in `globals.css` and `DESIGN.md` still equal what the generator produces; the generator itself refuses any pair under 4.5:1 text or 3:1 boundary contrast |
| Design file            | `npx -y @google/design.md@latest lint --format json DESIGN.md` | `DESIGN.md` is structurally valid (0 errors, 0 warnings)                                                                                                                       |
| Secrets in the browser | `pnpm check:bundle` (after a build)                            | Searches `.next/static` for the AI key's variable name or any `sk-...` style key, and fails if found                                                                           |
| Accessibility          | `e2e/a11y.spec.ts`                                             | See above                                                                                                                                                                      |

**Definition of done** in this repo (from `CLAUDE.md`): run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`, and report the real result. A feature also needs its tests, mobile layout, accessibility, loading and error states, and server-side ownership checks.

---

## 7. The mock AI provider

This is the piece most worth copying if the new project calls any paid or non-deterministic API.

**The seam** (`src/lib/ai/provider.ts`): feature code only ever sees an interface, never the SDK:

```ts
export interface AIProvider {
  readonly id: "anthropic" | "gemini" | "mock";
  modelName(tier: ModelTier): string;
  generateStructured(options: CallOptions, schema: z.ZodType): Promise<StructuredResult>;
  streamText(options: CallOptions): TextStream;
}
```

**Selection** (`src/lib/ai/index.ts`): `env.aiProvider === "mock" ? createMockProvider() : createSdkProvider()`. The SDK is imported in exactly one file, `providers/sdk.ts`.

**Environment rules** (`src/lib/env-schema.ts`): `E2E=true` forces the mock; otherwise the mock is the default everywhere except production; a real provider with no key switches AI off for everyone instead of crashing.

**The mock** (`src/lib/ai/providers/mock.ts`) returns deterministic fixtures built from a plain-data `fixture` object the caller passes, so a test can predict the answer without parsing prompt text. Two ways to make it misbehave on purpose:

- `AI_MOCK_MODE=error | slow` in the environment (every call), or
- the marker `[mock:error]` or `[mock:slow]` anywhere in the person's text (that call only). This lets **one running server** show a failure to one test without disturbing the others running in parallel.

**What this buys:** zero cost, no network, no key, deterministic assertions, and failure paths (timeouts, provider errors, invalid output) that can be tested on demand. A separate script, `scripts/check-client-bundle.mjs`, guards against shipping a real key in the browser bundle.

The same idea (an interface, a real adapter, a mock, and a switch in the environment) is used for email (`EmailSender` with `ResendEmailSender` and `ConsoleEmailSender`).

---

## 8. Project scripts and the commands to run

From `package.json`:

| Command                                                                 | What it does                                                   |
| ----------------------------------------------------------------------- | -------------------------------------------------------------- |
| `pnpm dev`                                                              | Dev server (runs `predev`: copies emoji data into `public/`)   |
| `pnpm build`, `pnpm start`                                              | Production build (standalone) and server                       |
| `pnpm lint`, `pnpm typecheck`, `pnpm format`                            | Quality checks                                                 |
| `pnpm test`                                                             | Unit tests                                                     |
| `pnpm test:integration`                                                 | Integration tests (needs the test database)                    |
| `pnpm test:e2e`                                                         | Browser tests (migrates, builds and serves on port 3100)       |
| `pnpm check:bundle`                                                     | Fail if a secret is in the browser bundle                      |
| `pnpm theme:generate`, `pnpm theme:check`                               | Regenerate or verify the color theme                           |
| `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`, `pnpm db:seed` | Migrations, local DB browser, demo user                        |
| `pnpm build:migrate`                                                    | Bundle the migration runner into `dist/migrate.mjs` for Docker |
| `pnpm capture:screens`, `pnpm capture:marketing`                        | Screenshot scripts                                             |

**Order I'd run before calling work done:** `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`, then `pnpm test:e2e` (the slow one), plus `pnpm theme:check` if colors changed.

---

## 9. Setting this up in a new project

A suggested order. Steps 1 to 6 give you the test setup; the rest are optional and depend on the new app.

1. **Node and pnpm.** Add `"engines": { "node": ">=24 <25" }`, `"packageManager": "pnpm@10.26.2"`, and a `.nvmrc` containing `24`. Run `corepack enable`.
2. **Install the test tools:**
   ```bash
   pnpm add -D vitest @playwright/test @axe-core/playwright tsx typescript
   ```
3. **Copy these files and adapt the names:** `vitest.config.ts`, `vitest.integration.config.ts`, `tests/stubs/server-only.ts`, `tests/integration/setup.ts`, `tests/integration/harness.ts`, `playwright.config.ts`, `e2e/env.ts`, `e2e/fixtures.ts`, `e2e/helpers.ts`, `e2e/mailbox.ts`, `e2e/db.ts`, `e2e/global-setup.ts`. Search them for `dayboard`, `Asia/Kolkata`, port `3100`, and the sign-up form labels, which are specific to this app.
4. **Add the scripts** `test`, `test:integration` and `test:e2e` from [section 8](#8-project-scripts-and-the-commands-to-run).
5. **Make the app testable:**
   - Read the build folder from an env var (`distDir: process.env.NEXT_DIST_DIR || ".next"`).
   - Add a cheap `/api/health` route (the Playwright `webServer.url` waits on it).
   - Add an `E2E=true` mode that swaps real email for a sender that appends links to a file, and forces any paid API to its mock.
   - Make `requireUser()` (or your equivalent) the **only** way to learn who is signed in, so integration tests can replace it in one place.
   - Keep rules in pure functions under `src/lib/` so unit tests are easy.
6. **Create the test database** and point `E2E_DATABASE_URL` at it: `createdb yourapp_test`.
7. **Optional, as needed:** the axe, reduced-motion and visual suites; `theme:generate` and its contrast test (only if you want a generated, contrast-checked palette); the `check-client-bundle` script (if you hold server secrets); the mock-provider pattern (if you call AI or other paid APIs).

**What to change per project:**

| In Dayboard                                             | Change to                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Better Auth and the sign-up/verify flow in `helpers.ts` | Your auth flow, or a seeded login via the database                                   |
| Table names in `e2e/db.ts`                              | Your schema                                                                          |
| Time zone `Asia/Kolkata`                                | The zone your date logic assumes (or remove it if you have none)                     |
| Port 3100 and `dayboard_test`                           | Your own                                                                             |
| `channel: "chrome"` locally                             | Remove it to use Playwright's own Chromium (`pnpm exec playwright install chromium`) |

---

## 10. Traps already hit

All of these are recorded in the repo's hand-off notes or visible in the code.

1. **A leftover test server can hold port 3100**, and the next Playwright run then fails to start with "Process from config.webServer was not able to start". Check `lsof -nP -iTCP:3100 -sTCP:LISTEN` before assuming the code is broken.
2. **Don't run `next dev` and the tests on the same build folder.** That is why `distDir` is configurable.
3. **`server-only` throws outside a Next.js build**, so both Vitest configs alias it to an empty stub.
4. **The Next.js route announcer adds an empty `role="alert"`** to every page, which makes `getByRole("alert")` ambiguous. Filter on non-empty text.
5. **Auth rate limits are per IP.** Without a unique `x-forwarded-for` per test, parallel tests share a bucket and fail randomly.
6. **Repeated triple clicks to select text are flaky in the browser.** Select with the keyboard.
7. **Playwright runs many browsers at once, which can starve animations.** The config raises the per-test timeout to 45 s and the `expect` timeout to 10 s. If a full run fails but each test passes alone, try `--workers=4`.
8. **Tests that depend on the clock fail at some hours.** One Today test ("Scheduled later today") fails between 23:30 and 06:00 IST because its 23:30 task is already overdue then. Pin the time zone, and avoid or mask clock-dependent content.
9. **Visual baselines are per operating system.** The ones in the repo were made on macOS (`...-darwin.png`); a Linux CI needs its own set, generated deliberately.
10. **Never send raw ProseMirror JSON to a Server Action.** Node attributes have no prototype and arrive as nothing; round-trip through `JSON.parse(JSON.stringify(...))` first. (Editor-specific, but it broke integration and end-to-end tests until fixed.)
11. **A menu that opens something else must do it from `onCloseAutoFocus`**, after the menu has closed. Otherwise the new thing dismisses itself immediately, and a test that "clicks through" can pass or fail depending on timing.
12. **Update visual baselines only after looking at the diff**: `pnpm test:e2e e2e/visual.spec.ts --update-snapshots`.

---

## 11. What is not set up

Stated plainly so you don't copy a gap by accident:

- **No CI.** There is no `.github/` folder and no workflow. Everything above is run by hand. The config already branches on `process.env.CI` (Chromium instead of Chrome, 2 workers, 1 retry, `forbidOnly`, the GitHub and HTML reporters), so it is ready for a CI job, but that job was never written or tested. It would need: Node 24, a PostgreSQL service, `createdb` for the test database, `pnpm install --frozen-lockfile`, `pnpm exec playwright install --with-deps chromium`, then the test commands, and a Linux set of visual baselines.
- **Husky hooks are not active.** `lint-staged` is configured, but there is no `.husky/` folder, so nothing runs on commit.
- **No coverage tooling.** There is no coverage reporter or threshold.
- **Docker has never been run on the development machine** (it isn't installed there), so the Dockerfile and Compose files are written but unverified.
- **Real third-party services are untested end to end:** Google and GitHub sign-in, Resend delivery, and live Anthropic or Gemini calls. Tests use the console sender and the mock provider. The repo keeps a manual checklist in `README.md` for these.
- **No load, security-scan or cross-browser testing.** Browser tests run in Chrome only (desktop and a Pixel 7 profile); Safari and Firefox are unverified.
- **No unit tests for React components** (no Testing Library or jsdom). Components are covered through the browser tests, and logic is kept in pure functions that the unit tests cover.

## Where to look in the repo

| Topic                                | Files                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Unit config and stub                 | `vitest.config.ts`, `tests/stubs/server-only.ts`                                                                                |
| Integration config, setup, harness   | `vitest.integration.config.ts`, `tests/integration/setup.ts`, `tests/integration/harness.ts`                                    |
| End-to-end config and helpers        | `playwright.config.ts`, `e2e/env.ts`, `e2e/fixtures.ts`, `e2e/helpers.ts`, `e2e/mailbox.ts`, `e2e/db.ts`, `e2e/global-setup.ts` |
| Mock AI and email senders            | `src/lib/ai/providers/mock.ts`, `src/lib/ai/provider.ts`, `src/lib/email/`                                                      |
| Environment rules for tests          | `src/lib/env-schema.ts`                                                                                                         |
| Bundle-secret check, theme generator | `scripts/check-client-bundle.mjs`, `scripts/generate-theme.ts`, `src/lib/theme/`                                                |
