# The Dayboard stack: every library and tool, and how they work together

**Date:** 2026-10-04
**Status:** Reference note. Describes the repo as it is today. No code changed.
**Question:** What third-party libraries and tools does Dayboard use, what does each one do on its own, and how do they fit together into one working app?

## How this note was made

- **From the repo, not from memory.** I read `package.json`, every config file (`next.config.ts`, `drizzle.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `components.json`, `eslint.config.mjs`, both Vitest configs, `playwright.config.ts`, `.prettierrc.json`, `Dockerfile`, `docker-compose.yml`), the scripts, and the code that uses each library. The "files that import it" counts come from searching `src`, `scripts`, `e2e` and `tests`.
- **What I did not do.** I did not re-check each library's current official docs for this note. The descriptions of what a library does come from general knowledge plus how this repo uses it. Several pinned versions (Next.js 16, React 19.3, TypeScript 6, Zod 4, Motion 14) are newer than what I know in detail, so treat version-specific behavior as "check the docs".
- **Plain language first.** Technical terms are explained where they first appear, and again in the [glossary](#10-glossary).

## Contents

1. [The big picture](#1-the-big-picture)
2. [Foundation: runtime, language, framework](#2-foundation-runtime-language-framework)
3. [Data: PostgreSQL, Drizzle, migrations](#3-data-postgresql-drizzle-migrations)
4. [Auth and email](#4-auth-and-email)
5. [Validation and AI](#5-validation-and-ai)
6. [Interface: styling, components, motion, editor](#6-interface-styling-components-motion-editor)
7. [Small utilities: dates, emoji](#7-small-utilities-dates-emoji)
8. [Developer tools: quality, tests, scripts](#8-developer-tools-quality-tests-scripts)
9. [Packaging and infrastructure](#9-packaging-and-infrastructure)
10. [Glossary](#10-glossary)

Then the second half of the note puts the pieces together:

- [A. How one request moves through the stack](#a-how-one-request-moves-through-the-stack) (five walkthroughs)
- [B. How the build, tests and delivery fit together](#b-how-the-build-tests-and-delivery-fit-together)
- [C. What the app does by hand, without a library](#c-what-the-app-does-by-hand-without-a-library)
- [D. Reference tables](#d-reference-tables) (every package, declared-but-not-imported, gotchas, what is not built yet)

---

## 1. The big picture

Dayboard is **one Next.js application** (a "modular monolith") that talks to **one PostgreSQL database** and to a few outside services. There is no separate backend server: the same project renders pages, handles form submissions and serves the API.

```text
                      ┌──────────────────────────── BROWSER ────────────────────────────┐
                      │  React 19 client components                                      │
                      │  Tiptap editor · Motion animation · cmdk menu · sonner toasts    │
                      │  next-themes · frimousse emoji picker · Radix primitives         │
                      └───────────────▲──────────────────────────────┬───────────────────┘
                         HTML/JS/CSS  │                              │  Server Actions (POST),
                         + streamed   │                              │  fetch() to /api/*,
                         AI text      │                              │  Better Auth client calls
                      ┌───────────────┴──────────────────────────────▼───────────────────┐
                      │                    NEXT.JS 16 SERVER (Node 24)                    │
                      │  proxy.ts (cookie check)                                          │
                      │  Server Components ── render pages, read data                     │
                      │  Server Actions ───── every create / update / delete              │
                      │  Route Handlers ───── /api/auth, /api/ai/*, /api/search, /health  │
                      │                                                                   │
                      │  Zod (checks input) · server-only (keeps secrets off the client)  │
                      │  Better Auth (who are you?) · AI SDK (talk to a model)            │
                      └──────────┬───────────────────────────┬───────────────┬────────────┘
                                 │ Drizzle ORM + postgres.js │               │
                      ┌──────────▼───────────┐     ┌─────────▼────────┐  ┌───▼───────────────────────┐
                      │   PostgreSQL 17      │     │ Resend (email)   │  │ Anthropic / Google Gemini │
                      │   17 tables          │     │ or console sender│  │ or the built-in mock      │
                      └──────────────────────┘     └──────────────────┘  └───────────────────────────┘
```

**Three ideas explain most of the design:**

1. **The server decides, the browser asks.** Every read and write goes through server code that first asks "who is this?" (`requireUser()`), then validates the input (Zod), then touches the database scoped to that person. Nothing the browser sends is trusted.
2. **Libraries are used at the edges, not woven through the middle.** For example, the AI SDK is imported in exactly one file, the email service in one file, and the database driver in one file. Swapping any of them means changing one place.
3. **The same rules are enforced by tools, not by memory.** Linting, type checking, unit tests, database-backed integration tests, browser tests, contrast checks and a "no secrets in the browser bundle" check all exist to keep these rules true as the code grows.

**Size of the app** (for scale): 368 TypeScript files in `src/`, 29 unit test files, 7 integration test files, 18 browser test files, 7 database migrations, 17 tables, 15 API routes (12 AI, plus auth, search, health).

---

## 2. Foundation: runtime, language, framework

### Node.js 24 (runtime) and pnpm 10 (package manager)

- **What:** Node runs JavaScript outside the browser. pnpm installs the project's dependencies.
- **Why here:** `package.json` pins `"engines": { "node": ">=24 <25" }` and `"packageManager": "pnpm@10.26.2"`; `.nvmrc` says `24`. The Docker image also uses `node:24-alpine`. `corepack enable` (built into Node) makes the pinned pnpm version run automatically.
- **Why pnpm and a lockfile:** `pnpm-lock.yaml` records the exact version of every package, including packages that packages depend on. Builds (and the Docker image, via `--frozen-lockfile`) are therefore repeatable.

### TypeScript 6.0.3 (language)

- **What:** JavaScript plus types, checked before the code runs.
- **Config:** `tsconfig.json` has `strict: true` and `noUncheckedIndexedAccess: true` (an array lookup like `list[0]` is typed as "might be missing"). The `@/*` alias points to `src/*`. `noEmit: true` means TypeScript only checks; Next.js and `tsx` do the actual compiling.
- **Pinned on purpose:** version 6.0 is held by an ADR (`docs/decisions/0001-pin-typescript-6.md`).
- **Command:** `pnpm typecheck`.

### Next.js 16.3.8 (the framework)

- **What:** A framework built on React that handles routing, server rendering, building and serving.
- **Features Dayboard relies on:**
  - **App Router:** folders under `src/app/` are routes. Groups in parentheses (`(app)`, `(auth)`, `(marketing)`, `(onboarding)`) share a layout without changing the URL.
  - **Server Components (default):** run only on the server, so they can read the database directly and ship no JavaScript for themselves.
  - **Client Components** (`"use client"`): run in the browser for interaction (editor, menus, animation).
  - **Server Actions** (`"use server"`): functions the browser calls like normal functions, which run on the server. They are used for every mutation (`src/actions/*.ts`).
  - **Route Handlers** (`route.ts`): plain HTTP endpoints. Used only where a plain endpoint is needed: Better Auth (`/api/auth/*`), streaming AI (`/api/ai/*`), `/api/search`, `/api/health`.
  - **`proxy.ts`** (Next 16's replacement for middleware): runs before a request. Dayboard uses it only for an optimistic "does a session cookie exist?" redirect and to stamp a request id. It is explicitly _not_ the real access check.
  - **`next/image`:** used once, for the landing page screenshots (served as AVIF/WebP).
  - **Metadata files:** `manifest.ts`, `robots.ts`, `sitemap.ts`, `opengraph-image.tsx`, `apple-icon.tsx`.
- **Config (`next.config.ts`):**
  - `output: "standalone"` builds a small self-contained server for Docker.
  - `serverExternalPackages: ["postgres"]` stops Next from bundling the database driver.
  - `distDir` can be overridden, so test builds go to `.next-e2e` and never disturb a running `next dev`.
  - `agentRules: false` stops `next dev` from appending its own block to `CLAUDE.md`.
  - `poweredByHeader: false` removes the `X-Powered-By` header.

### React 19.3 and react-dom

- **What:** The UI library underneath Next.js. Components are functions that return markup.
- **Used for:** everything visible. Instant-feeling updates (a task ticks immediately, then the server confirms) use plain React state and `useTransition` (6 files) plus a small home-made hook, `useOverride` (`src/hooks/use-override.ts`, 5 files). React's own `useOptimistic` is not used.

### server-only 0.0.1

- **What:** A tiny package that makes a build **fail** if a file marked `import "server-only"` is ever imported by browser code.
- **Why here:** 38 files use it (database client, auth config, env, AI, email, queries). It is the guard that keeps database passwords and API keys out of the browser bundle.
- **Test detail:** it throws outside a Next.js build, so both Vitest configs alias it to `tests/stubs/server-only.ts`.

---

## 3. Data: PostgreSQL, Drizzle, migrations

### PostgreSQL 17 (the database)

- **What:** A relational database. All user data lives here: tasks, todos, notes, projects, tags, inbox items, AI usage, plus Better Auth's own tables.
- **Tables (17):** `user`, `session`, `account`, `verification`, `rate_limit`, `user_preferences`, `tasks`, `todos`, `projects`, `notes`, `tags`, `task_tags`, `note_tags`, `task_notes`, `inbox_items`, `ai_usage`, `ai_daily_suggestions`.
- **Features used:** `jsonb` (rich-text documents), native enums, 18 `CHECK` constraints (database-level rules such as "a task is DONE only if it has a completed time"), foreign keys with `ON DELETE CASCADE` (deleting a user removes all their data), and indexes.
- **Search** is plain `ILIKE` with a hand-written ranking (`src/db/queries/search.ts`). There is no full-text or trigram index yet.
- **Locally:** `docker-compose.yml` runs `postgres:17`, or you can use any local Postgres.

### postgres 3.4.9 (the driver, often called "postgres.js")

- **What:** The library that actually speaks to PostgreSQL from Node, with a connection pool.
- **Where:** `src/db/client.ts` creates one pool (`max: 10`) and reuses it across hot reloads in development (via `globalThis`). Also used by `scripts/migrate.ts` and the `/api/health` check.
- **Detail:** it is listed in `serverExternalPackages` so Next doesn't bundle it.

### drizzle-orm 0.45.3 (the ORM)

- **What:** An **ORM** ("object-relational mapper"): you describe tables in TypeScript and write queries as typed code instead of raw SQL strings. Drizzle stays close to SQL, which suits a project that wants to see what runs.
- **Where:** 49 files. Table definitions live in `src/db/schema/*.ts` (`pgTable`, `pgEnum`, `check`, `index`, `jsonb`, `uuid`, `timestamp`). Reads are in `src/db/queries/`, writes in `src/db/mutations/`.
- **How it is used here:** every query filters by `user_id`, and every write runs as a transaction. Raw `sql` snippets are used where needed (search ranking, "does this project exist and belong to this user").
- **Gotcha:** schema files import with **relative paths** (`../../lib/ids`), not `@/`, because `drizzle-kit` loads them without the TypeScript alias.

### drizzle-kit 0.31.11 (migration generator, dev tool)

- **What:** Reads the schema files and writes **migrations**: numbered `.sql` files that change the database step by step.
- **Where:** `drizzle.config.ts` (loads `.env.local` itself because drizzle-kit doesn't). Commands: `pnpm db:generate`, `pnpm db:studio` (a local database browser).
- **Rule:** a migration that has been applied is never edited; changes get a new file. There are seven so far (`0000_init` to `0006_ai-writing-planning`).

### The migration runner (`scripts/migrate.ts`)

- Applies pending migrations using `drizzle-orm`'s migrator and `postgres`. It is deliberately self-contained (no `@/` imports) so it can be bundled alone.
- **esbuild** compiles it into one file (`pnpm build:migrate` → `dist/migrate.mjs`) for the Docker image. **tsx** runs the TypeScript version directly during development (`pnpm db:migrate`).

---

## 4. Auth and email

### better-auth 1.7.7 (authentication)

- **What:** A self-hosted authentication library. It runs **inside the Next.js app and uses the app's own database**, instead of being a hosted service like Clerk.
- **What it does for Dayboard** (configured in `src/lib/auth.ts`):
  - Email and password (hashed by the library; 10–128 characters), with required email verification once a real email provider is configured.
  - Google and GitHub sign-in (only enabled when both the client ID and secret are set).
  - Magic-link sign-in (via the `magicLink` plugin, 10-minute links).
  - Sessions (30-day expiry, refreshed daily; "fresh" for 10 minutes for sensitive actions), password reset, change email, link and unlink providers, sign out other devices, delete account.
  - One account per person: signing in with Google using an email that already has an account links to it (but only if the existing email was verified).
  - Rate limiting stored in the database (`rate_limit` table), with tighter limits on sign-in, sign-up, reset and magic-link requests.
- **Pieces in the repo:**
  - `src/lib/auth.ts`: the server configuration.
  - `src/lib/auth-client.ts`: the browser client (`createAuthClient` with `magicLinkClient`). It holds no secrets.
  - `src/app/api/auth/[...all]/route.ts`: one line that mounts all of Better Auth's endpoints (`toNextJsHandler(auth)`).
  - `src/lib/session.ts`: `getSession()` and **`requireUser()`**, the only way any page or action learns who is signed in.
  - `src/proxy.ts`: uses `getSessionCookie` from `better-auth/cookies` for the optimistic redirect.
  - `nextCookies()` (last plugin) lets Server Actions set auth cookies.
- **Related packages:** see [declared but not imported](#declared-but-not-imported-directly).
- **What Better Auth does _not_ do:** it has no screens (Dayboard builds its own forms), no email sending (Dayboard supplies the sender), and it can't register your app with Google or GitHub (you create those OAuth apps yourself).

### @better-auth/drizzle-adapter 1.7.7

- **What:** The bridge that lets Better Auth store users, sessions and accounts through Drizzle in the app's PostgreSQL. Used once, in `src/lib/auth.ts` (`drizzleAdapter(db, { provider: "pg", schema })`).
- IDs for these tables are generated by the app (UUID v7, see [section C](#c-what-the-app-does-by-hand-without-a-library)), so every table uses the same ID style.

### resend 6.31.0 (sending email)

- **What:** An email delivery service with a Node client.
- **Where:** only `src/lib/email/resend-sender.ts` imports it. Everything else talks to a small `EmailSender` interface (`src/lib/email/`), with two implementations:
  - `ResendEmailSender`: real delivery. Used when `RESEND_API_KEY` is set (required in production).
  - `ConsoleEmailSender`: development and tests. Prints links to the terminal, or in E2E runs appends each email to `.e2e/emails.jsonl` so Playwright can click verification and reset links.
- **Privacy rule:** logs show the template name and a hashed recipient, never the body or the link.
- **Fire-and-forget:** `sendEmail()` is intentionally not awaited, so response timing can't reveal whether an account exists.
- Email templates are plain table-based HTML written by hand (`src/lib/email/templates.ts`).

---

## 5. Validation and AI

### zod 4.6.5 (validation)

- **What:** Describes the shape of data once, then checks any value against it and gives you a typed result.
- **Where (18 files):**
  - Environment variables (`src/lib/env-schema.ts`). The app refuses to start with a clear message if one is wrong.
  - Every Server Action input (`src/lib/validations/*.ts`).
  - Every AI request body and every AI **answer** (`src/lib/ai/schemas.ts`), so a model can't smuggle in a malformed result.
  - The editor document whitelist (`src/lib/editor/schema.ts`).
- **Pattern:** `runAction()` (`src/lib/actions.ts`) catches a `ZodError` and turns it into friendly per-field messages.

### ai 7.0.127 (the Vercel AI SDK), @ai-sdk/anthropic 4.0.71, @ai-sdk/google 4.0.87

- **What:** The AI SDK gives one API for many model vendors (`generateText`, `streamText`, structured output with `Output.object`). The two `@ai-sdk/*` packages are the vendor connectors for Anthropic (Claude) and Google (Gemini).
- **Where:** imported in **exactly one file**, `src/lib/ai/providers/sdk.ts`. The rest of the app sees only the `AIProvider` interface (`src/lib/ai/provider.ts`).
- **Three providers behind one interface:**
  - `anthropic` and `gemini`: real models, chosen by `AI_PROVIDER` (default models differ per vendor).
  - `mock` (`src/lib/ai/providers/mock.ts`): deterministic fixtures. The default outside production, and forced on in every test run, so tests never call a paid API.
- **A real provider with no `AI_API_KEY`** switches AI off for everyone; every AI button hides and the rest of the app works.
- **Settings → AI** names the provider and shows its privacy link (and a free-tier warning for Gemini).
- Full request flow is in [walkthrough A5](#a5-an-ai-request-plan-my-day-ask-writing-help).

---

## 6. Interface: styling, components, motion, editor

### tailwindcss 4.3.3 and @tailwindcss/postcss 4.3.3

- **What:** A "utility-first" CSS tool: you style elements with small classes (`flex`, `gap-2`, `text-muted-foreground`) instead of writing CSS files.
- **Tailwind v4 is configured in CSS, not JavaScript.** There is no `tailwind.config` file (`components.json` sets `"config": ""`). `src/styles/globals.css` contains `@import "tailwindcss"`, a `@theme inline { … }` block that maps design tokens to utility names, `@utility` rules (the type scale, `float-surface`, `shadow-float`) and a dark-mode variant (`@custom-variant dark (&:is(.dark *))`).
- **`postcss.config.mjs`** has one plugin, `@tailwindcss/postcss`, which does the processing at build time.
- **Design tokens as CSS variables:** colors, radii and fonts are CSS variables (`--background`, `--primary`, …) set for light (`:root`) and dark (`.dark`). That is what makes theming a class switch.

### tw-animate-css 1.4.0

- **What:** Ready-made animation classes for Tailwind v4 (`animate-in`, `fade-in-0`, `zoom-in-98`, `slide-in-from-right`).
- **Where:** imported once in `globals.css`. Used by dialogs, menus, popovers and the sheet via Radix's `data-[state=open]` and `data-[state=closed]` attributes, e.g. `data-[state=open]:animate-in`.

### shadcn/ui (a pattern, not a package)

- **What:** shadcn/ui is **not installed as a dependency**. It is a way of working: component source code is copied into your project and you own it. `components.json` records the settings (`new-york` style, CSS variables, `@/components/ui`, Lucide icons).
- **Here:** `src/components/ui/` holds Dayboard's own versions: `alert`, `button`, `check-button`, `dialog`, `dropdown-menu`, `field`, `input`, `kbd`, `label`, `native-select`, `password-input`, `popover`, `segmented-control`, `sheet`, `sonner`, `switch`, `tooltip`, `user-avatar`. They were adapted to the Dayboard design rather than left at shadcn's default look.
- It is the only "component system" allowed (a project rule).

### radix-ui 1.6.7

- **What:** Unstyled, accessible building blocks for hard-to-get-right widgets: focus management, keyboard control, screen-reader labels, positioning.
- **Where (8 files):** the single `radix-ui` package supplies `Dialog` (dialog, sheet, command menu), `Popover`, `DropdownMenu`, `Tooltip`, `Switch` and `RadioGroup`. Each is wrapped once in `src/components/ui/` and styled with Tailwind.
- **Why it matters:** it gives dialogs focus trapping, Escape to close, and correct ARIA without Dayboard writing that logic.

### class-variance-authority 0.7.1, clsx 2.1.1, tailwind-merge 3.7.0

Three tiny helpers that together make styling components clean:

- **`clsx`:** joins class names conditionally (`clsx("a", isOn && "b")`).
- **`tailwind-merge`:** when two Tailwind classes conflict (`px-4` and `px-2`), keeps the last one.
- **`cn()`** (`src/lib/utils.ts`) is `twMerge(clsx(...))`, used everywhere.
- **`class-variance-authority` (cva):** declares **variants** once. `src/components/ui/button.tsx` defines `primary`, `secondary`, `ghost` and `destructive` and nothing else, so the "no fourth button level" design rule is enforced by code.

### lucide-react 1.49.0 (icons)

- 62 different icons used across 76 files. By convention they are drawn at 16px with a 1.5px stroke. Imported by name, so only the icons used reach the browser.

### next-themes 0.4.6 (light, dark, system)

- **What:** Applies a `dark` class to `<html>` and remembers the choice, with no flash of the wrong theme on load.
- **Where:** `ThemeProvider` in `src/app/layout.tsx` (`attribute="class"`, default `system`). Settings and onboarding call `setTheme`. `theme-sync.tsx` keeps the browser's choice in step with the saved preference. Sonner reads the theme too.
- Because dark mode is a class on `<html>`, Tailwind's `dark` variant and the CSS variables switch together.

### sonner 2.0.8 (toasts)

- **What:** The small pop-up messages ("Task completed. Undo").
- **Where:** `src/components/ui/sonner.tsx` styles it (bottom-left, inverted colors, `z-index: 60`). 44 files call `toast(...)`. The 5-second Undo for completing a task is a toast action.

### cmdk 1.1.1 (command menu)

- **What:** An unstyled command-palette component (input, list, groups, keyboard navigation).
- **Where:** only `src/components/command/command-menu.tsx`. Its own filtering is **turned off** because search happens on the server (`/api/search`), where ranking, ownership and privacy are controlled. cmdk contributes keyboard navigation and structure.

### @fontsource-variable/inter 5.3.0 (font)

- **What:** The Inter typeface packaged to be served from the app itself (not from Google's servers). `globals.css` imports `@fontsource-variable/inter/opsz.css`, which includes the optical-size axis used for headings.
- **Why:** faster, works offline in development, and no third party learns who loads the page. Inter replaced the earlier serif and Plex fonts (ADR 0003).

### motion 14.0.0 (animation)

- **What:** An animation library for React (the successor to Framer Motion), imported from `motion/react`.
- **Where (12 files):** `src/lib/motion.ts` holds every duration, easing and spring in one place. `MotionProvider` wraps the app with `<MotionConfig reducedMotion="user">`: for people who ask their system for less motion, Motion switches off movement and layout animation and keeps gentle fades. Used for list rows entering, leaving and re-ordering (`AnimatePresence` ×23, `motion.li` ×6), the task side panel, route fades (`app/(app)/template.tsx`), counters, the Plan my day dialog and AI panels.
- **Rules from `DESIGN.md`:** at most two feature animations per screen, only `transform` and `opacity`, lists over 100 rows skip per-row layout animation.

### Tiptap 3.31.4 (the rich-text editor)

Tiptap is a toolkit built on **ProseMirror**, a low-level engine for editable documents. Dayboard uses these packages:

| Package                         | Role                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `@tiptap/react`                 | The React bindings: `useEditor`, `EditorContent`, `useEditorState`, `BubbleMenu`                                   |
| `@tiptap/pm`                    | The ProseMirror packages Tiptap builds on, pinned to match                                                         |
| `@tiptap/starter-kit`           | Paragraphs, headings (1–3), bold, italic, underline, strike, lists, quote, code, horizontal rule, links, undo/redo |
| `@tiptap/extension-list`        | Task lists with checkable items (`TaskList`, `TaskItem`)                                                           |
| `@tiptap/extension-placeholder` | The "start writing…" hint                                                                                          |
| `@tiptap/extension-bubble-menu` | The floating bar that appears over selected text (used through `@tiptap/react/menus`)                              |

- **Where:** the extension list lives in one place, `src/components/editor/extensions.ts`, so the live editor and the read-only AI preview hold exactly the same kinds of content. The editor loads on the client only.
- **The saved format:** the document is stored as **Tiptap JSON** (`jsonb`) and a plain-text copy is built **on the server** for search and AI. The browser never supplies the text copy. Incoming JSON passes a Zod whitelist (`sanitizeDoc`) that rejects unknown node types and oversized or too-deep input.
- **Link safety:** only `http`, `https` and `mailto` links, opened with `rel="noopener noreferrer nofollow"`.

### @floating-ui/dom 1.8.0

- Positioning math ("put this floating bar above the selection"). It is a dependency of Tiptap's bubble menu and is not imported directly by Dayboard. Radix brings its own positioning copy for menus and popovers.

---

## 7. Small utilities: dates, emoji

### date-fns 4.4.0 and @date-fns/tz 1.5.0 (dates and time zones)

- **What:** Date formatting and arithmetic; `@date-fns/tz` adds time-zone-aware dates (`TZDate`).
- **Where:** `src/lib/dates/relative.ts` ("2 days ago", "Sep 18") and `src/lib/dates/today.ts` (what "today" means for a person).
- **Why it matters:** "due today" and "overdue" must follow the **person's** time zone and their chosen start of day (default 06:00), so a task due today is still "today" at 1 a.m. Tasks store a local date plus an optional local time, not a single timestamp.
- Rule: no other date library may be added.

### frimousse 0.4.0 and emojibase-data 17.0.0 (emoji picker)

- **frimousse:** an unstyled emoji-picker component. Wrapped in `src/components/emoji/emoji-picker.tsx` (a popover on desktop, a bottom sheet on phones).
- **emojibase-data:** the emoji list itself (names, groups, search words).
- **How they connect:** by default the picker would fetch its data from a public CDN every time, telling a third party when people open it. Instead `scripts/copy-emoji-data.mjs` runs before `dev` and `build` (`predev`/`prebuild`) and copies two JSON files from `node_modules/emojibase-data` into `public/emojibase/` (git-ignored), and the picker is told `emojibaseUrl="/emojibase"` (ADR 0002).
- Validation that a value is exactly one emoji is hand-written (`src/lib/emoji.ts`, using `Intl.Segmenter`).

---

## 8. Developer tools: quality, tests, scripts

These never ship to users.

| Tool                                            | Version        | What it does here                                                                                                                                                                                                                                                                 |
| ----------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ESLint** + `eslint-config-next`               | 9.39 / 16.3.8  | Finds bugs and risky patterns. Uses Next's `core-web-vitals` and TypeScript rule sets, including React hooks rules. `pnpm lint`.                                                                                                                                                  |
| **Prettier** + `prettier-plugin-tailwindcss`    | 3.9.9 / 0.8.1  | One code style (100 columns, double quotes, trailing commas). The plugin sorts Tailwind classes using `globals.css` as the reference. `pnpm format`.                                                                                                                              |
| **Husky** + **lint-staged**                     | 9.1.7 / 17.6.0 | Meant to format and lint staged files on commit. `lint-staged` rules are configured, but there is **no `.husky/` folder**, so no hook runs yet (`"prepare": "husky \|\| true"` tolerates that).                                                                                   |
| **Vitest**                                      | 5.0.3          | Two suites. **Unit** (`tests/unit`, 29 files): pure logic in plain Node. **Integration** (`tests/integration`, 7 test files plus a shared harness): the real Server Actions and queries against a **real PostgreSQL test database** (`dayboard_test`), never the development one. |
| **Playwright**                                  | 1.63.0         | Real-browser end-to-end tests (`e2e/`, 18 files). It builds a production copy, serves it on port 3100 against the test database, with **mock AI and console email**, then drives Chrome (desktop and a Pixel 7 phone profile). Also takes the visual screenshot baselines.        |
| **@axe-core/playwright**                        | 4.13.0         | Accessibility scanner run inside Playwright tests (color contrast and more), in light and dark.                                                                                                                                                                                   |
| **tsx**                                         | 4.23.15        | Runs TypeScript scripts directly: migrations, seed, theme generator, screenshot capture.                                                                                                                                                                                          |
| **esbuild**                                     | 0.28.2         | Bundles the migration runner into one file for Docker.                                                                                                                                                                                                                            |
| **drizzle-kit**                                 | 0.31.11        | See [section 3](#3-data-postgresql-drizzle-migrations).                                                                                                                                                                                                                           |
| **@types/node, @types/react, @types/react-dom** |                | Type definitions so TypeScript understands Node and React.                                                                                                                                                                                                                        |

**Project scripts** (in `scripts/`):

- `migrate.ts`, `seed.ts` (a demo user, development only).
- `generate-theme.ts` (with `--check`): see [section C](#c-what-the-app-does-by-hand-without-a-library).
- `check-client-bundle.mjs`: after a build, searches `.next/static` for the AI key's name or any `sk-…` style key and fails if found.
- `copy-emoji-data.mjs`, `capture-screens.ts`, `capture-marketing.ts`.

---

## 9. Packaging and infrastructure

### Docker (multi-stage `Dockerfile`)

Four stages, each one small and cacheable:

1. **base:** `node:24-alpine`, enables corepack/pnpm.
2. **deps:** `pnpm install --frozen-lockfile` (cached until the lockfile changes).
3. **builder:** copies the source, runs `pnpm build` (Next standalone output) and `pnpm build:migrate` (esbuild bundle).
4. **runtime:** a fresh Alpine Node image containing only the standalone server, static files, `public/`, `migrate.mjs` and the migration SQL. Runs as a **non-root** user, holds **no secrets** (everything arrives as environment variables), and has a `HEALTHCHECK` on `/api/health`.

`.dockerignore` keeps the specs, designs, docs, tests and `.env*` files out of the image.

### Docker Compose (`docker-compose.yml`)

- `docker compose up -d db` starts PostgreSQL 17 on `127.0.0.1` only, with a named volume so data survives restarts. The everyday workflow is then `pnpm dev` natively.
- `--profile full` also builds the production image, runs a one-shot `migrate` service, then starts `web`. It sets `E2E=true` so a production build can start without an email provider.

### `/api/health`

One `select 1` with a 2-second timeout. Returns `{ status, db, version }` (HTTP 200, or 503 if the database is down). Docker's healthcheck and deployment scripts rely on it.

### Planned, not built yet (feature 06)

Caddy (HTTPS reverse proxy), `docker-compose.prod.yml`, GitHub Actions CI and CD, GitHub Container Registry, backup and rollback scripts, and a `.github/` folder. None of these exist in the repo today.

### External services (not libraries)

| Service                 | Used for                         | Status                                                                  |
| ----------------------- | -------------------------------- | ----------------------------------------------------------------------- |
| Resend                  | Real email delivery              | Code complete; needs an API key and a verified domain                   |
| Anthropic API           | Claude models                    | Code complete; needs `AI_API_KEY`                                       |
| Google Gemini API       | Gemini models (free tier option) | Code complete; needs `AI_API_KEY`                                       |
| Google and GitHub OAuth | "Continue with Google / GitHub"  | Code complete; you create the OAuth apps and supply the IDs and secrets |

---

## 10. Glossary

- **App Router:** Next.js's folder-based routing system.
- **Server Component:** a React component that runs only on the server.
- **Client Component:** a React component that runs in the browser (`"use client"`).
- **Server Action:** a server function the browser can call like a normal function; used here for every create, update and delete.
- **Route Handler:** a plain HTTP endpoint in Next.js (`route.ts`).
- **ORM:** a layer that lets you work with database tables through code.
- **Migration:** a numbered SQL file that changes the database structure one step at a time.
- **Transaction:** several database changes that all succeed or all fail together.
- **`jsonb`:** a PostgreSQL column type that stores structured JSON (used for the editor document).
- **`ILIKE`:** PostgreSQL's case-insensitive text match.
- **ProseMirror:** the low-level editing engine under Tiptap.
- **Optimistic update:** showing the result in the UI at once, then confirming (or undoing) after the server answers.
- **NDJSON:** "newline-delimited JSON": a stream with one JSON object per line. The AI routes stream this so text can appear as it is written.
- **Structured output:** asking a model for data in a fixed shape that can then be checked with Zod.
- **Mock provider:** a stand-in for the AI that returns fixed, predictable answers, so tests cost nothing and don't need a network.
- **Standalone output:** a Next.js build mode that produces a minimal server folder, ideal for Docker.
- **Design token:** a named design value (a color, a radius) stored as a CSS variable.
- **Contrast ratio:** how readable one color is on another (WCAG asks for 4.5:1 for normal text).
- **Lockfile:** the file recording the exact version of every installed package.

---

# Part two: how it all fits together

## A. How one request moves through the stack

### A1. Showing a page (for example, Today)

1. The browser asks for `/today`. **`src/proxy.ts`** runs first. If there is no session cookie it redirects to `/sign-in?next=/today`. It also adds a request id header. (Cookie present does _not_ mean allowed; it only skips the redirect.)
2. **Next.js** renders `src/app/(app)/today/page.tsx` as a **Server Component**.
3. The page calls **`requireUser()`** (`src/lib/session.ts`), which asks **Better Auth** (`auth.api.getSession`) to look up the session in PostgreSQL via the **Drizzle adapter**. No valid session means a redirect.
4. The page calls one loader (`getTodayData`), which runs parallel queries through **Drizzle** and **postgres.js**. Every query includes the signed-in person's id. Dates use **date-fns + @date-fns/tz** with that person's time zone.
5. React turns the result into HTML on the server. **Tailwind** classes (compiled by `@tailwindcss/postcss`) style it; **Inter** is served from the app itself; **lucide-react** icons render as inline SVG.
6. The HTML arrives in the browser and **hydrates**: only the interactive parts (rows, menus, the command menu, motion) ship JavaScript. **next-themes** applies the `dark` class, **Motion** handles entrance animation, and **Sonner** is ready for toasts.

### A2. Doing something (ticking a task done)

1. In the browser the task row (a Client Component) updates **optimistically** (a local value held on top of the server's, via the small `useOverride` hook): the checkbox fills instantly and **Motion** animates the row.
2. It calls a **Server Action** (`src/actions/tasks.ts`). The body is wrapped in **`runAction()`**, which always returns a plain `{ ok, data | error }` result instead of throwing.
3. Inside: **`requireUser()`** (Better Auth) → **Zod** parses the input → a **Drizzle transaction** (`src/db/mutations/tasks.ts`) runs the pure status rules (`src/lib/tasks/status.ts`), locks the row, writes `status` and `completed_at`, and for repeating tasks creates the next occurrence → `revalidatePath` refreshes the affected pages.
4. Back in the browser, **Sonner** shows "Task completed" with **Undo** for 5 seconds. Undo calls another Server Action. If the server fails, the optimistic change is reverted and an error toast with Retry appears.
5. If Zod rejects the input, the field errors come back through `runAction` as friendly messages. If something unexpected breaks, `logger` records it with the request id and the person sees a plain message.

### A3. Signing in (email and password, or Google)

1. The sign-in form (`src/components/auth/sign-in-form.tsx`) calls **`authClient.signIn.email(...)`** or **`signIn.social({ provider: "google" })`** from **better-auth/react**.
2. The request goes to **`/api/auth/[...all]`**, which hands it to Better Auth. Better Auth checks its **database-backed rate limit** first (5 sign-in attempts a minute).
3. It verifies the password hash (or runs the OAuth redirect and callback with Google), reads or creates rows in `user`, `account` and `session` through the **Drizzle adapter**, and, for a new user, a hook creates default `user_preferences`.
4. The **`nextCookies()`** plugin sets the session cookie. If email verification is required (a real email provider is configured), Better Auth calls `sendVerificationEmail`; Dayboard's `sendEmail()` sends it through **Resend** (or prints it in development).
5. The browser is sent on (to `/onboarding` for a new person, otherwise to Today). Every later request carries the cookie, and A1 step 3 validates it.

### A4. Saving a note

1. In the browser **Tiptap** edits the document. `useNoteSync` (`src/components/notes/use-note-sync.ts`) waits 800 ms after the last keystroke, then sends the document to a Server Action **together with the version number the editor last saw**.
2. The editor's JSON is first made into plain JSON (`toPlainDoc`); sending raw ProseMirror objects to a Server Action silently drops some data (a gotcha recorded in the hand-off notes).
3. On the server: `requireUser()` → **Zod** whitelist (`sanitizeDoc`: allowed node types, size and depth caps) → a plain-text copy is built (`toPlainText`) → **Drizzle** updates `content_json` (`jsonb`) and `content_text` only `WHERE id = … AND user_id = … AND version = <the version it saw>`.
4. If another window changed the note, zero rows update and the app returns `outcome: "conflict"`; the editor offers **Load latest** or **Keep mine**. On a network failure the text is kept in memory and in `localStorage`, retried with back-off, and offered back after a reload.
5. The status text ("Saving…", "Saved", "Not saved, retrying") is plain text, with no toast.

### A5. An AI request (Plan my day, Ask, Writing help)

1. The browser calls a **Route Handler** under `/api/ai/…` with `fetch()` (client code in `src/components/ai/ai-client.ts` reads the response stream line by line).
2. **`gate.ts`** runs the shared front half: **`requireUser()`** → is AI available and switched on for this person → **Zod** validates the body → per-minute and per-day **limits** are checked against `ai_usage` in PostgreSQL.
3. The route loads only the records it needs **by id and owner** (or, for Ask, a bounded set found by the same search code), and wraps them in `<data>` blocks with an instruction that this text is material, not commands.
4. The **`ai` facade** (`src/lib/ai/index.ts`) calls the chosen **provider**: the **AI SDK** (inside `providers/sdk.ts`) talking to Anthropic or Gemini, or the mock. It adds timeouts (30 s structured, 60 s streams), one automatic retry, and **Zod validation of the answer**, and records a usage row (never the prompt or the answer).
5. The route streams the result back as **NDJSON**. The browser shows it in a **preview** (a panel, dialog or checklist) styled like the editor.
6. **Nothing is saved yet.** Only a click on the confirm button calls the _existing_ Server Actions from A2 (for example `createTasksBatch` or `updateTask`). AI output therefore passes through the same validation and ownership checks as anything a person types.

### A6. How styling and theming connect

1. **Colors are generated, not hand-picked.** `scripts/generate-theme.ts` (with `src/lib/theme/`) builds both themes from three inputs using OKLCH color math, **refuses** to write any pair below 4.5:1 text contrast or 3:1 for UI boundaries, and writes the result into marked blocks in `globals.css` and `DESIGN.md` (run with `--check` to verify nothing drifted).
2. **Tailwind v4's `@theme inline`** exposes those CSS variables as utilities (`bg-primary`, `text-muted-foreground`).
3. **Components** combine **cva** (variants), **cn** (clsx + tailwind-merge), **Radix** (behavior and accessibility) and **lucide-react** (icons). `tw-animate-css` provides open/close animation, **Motion** provides list, sheet and route animation.
4. **next-themes** flips the `dark` class; the CSS variables change; every component follows without extra code.

---

## B. How the build, tests and delivery fit together

```text
 pnpm install  ──►  predev/prebuild: copy emoji data into public/
      │
      ├─ pnpm dev ───────────► next dev (Node, hot reload) ◄── PostgreSQL (Docker or local)
      │
      ├─ Quality gates (all local today; CI is planned):
      │     pnpm lint · pnpm typecheck · pnpm test (unit)
      │     pnpm test:integration  → real Server Actions + real test database
      │     pnpm test:e2e          → builds + serves production, drives Chrome,
      │                              mock AI, console email, axe contrast, screenshots
      │     pnpm theme:check       → generated colors still match the recipe
      │     design.md lint         → DESIGN.md is structurally valid
      │     pnpm check:bundle      → no AI key in the browser bundle
      │
      └─ Ship:  pnpm build (standalone)  +  esbuild (migrate.mjs)
                    │
                    ▼
              Docker image (non-root, health-checked)
                    │   run one-shot "migrate", then the web container
                    ▼
              PostgreSQL volume   (production target: Caddy + Compose on one VM; feature 06)
```

**Why the test setup is built this way:**

- **Unit tests** need no database, so they run in milliseconds. `server-only` is stubbed so server modules can load in plain Node.
- **Integration tests** call the real Server Actions against a real PostgreSQL test database, and include an ownership check (one person can't touch another's data). They use `E2E_DATABASE_URL` and never `DATABASE_URL`, so development data is safe.
- **End-to-end tests** test what a person sees. Playwright's `webServer` setting runs `pnpm db:migrate && pnpm build && pnpm start -p 3100` with test-only environment values: `E2E=true` (console email written to a file Playwright can read), `AI_PROVIDER=mock` with no key, and OAuth switched off. This is why tests never email anyone, never spend money on AI, and never depend on a developer's `.env.local`.
- A time zone (`Asia/Kolkata`) is pinned in the Playwright config so "today" and "overdue" behave identically everywhere.

---

## C. What the app does by hand, without a library

Knowing what is _not_ a dependency matters as much as knowing what is. These are written in the repo:

| Capability                                          | Where                                                                 | Notes                                                                                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Logging with secret redaction                       | `src/lib/logger.ts`                                                   | JSON lines in production, pretty output in development, redacts keys such as password, token, secret, cookie, link. No logging library. |
| UUID v7 ids                                         | `src/lib/ids.ts`                                                      | Time-sortable, generated in the app so any Postgres version works. Also given to Better Auth.                                           |
| Environment validation                              | `src/lib/env-schema.ts`                                               | Written with Zod; fails fast with a readable list of problems.                                                                          |
| Typed errors and the action wrapper                 | `src/lib/errors/`, `src/lib/actions.ts`                               | One error shape for every action.                                                                                                       |
| Markdown → editor document                          | `src/lib/editor/markdown.ts`                                          | Tolerant of half-arrived streamed text, never throws. No `remark` or `marked`.                                                          |
| Editor document whitelist                           | `src/lib/editor/schema.ts`                                            | Zod-based.                                                                                                                              |
| Replace-selection planning for Writing help         | `src/lib/editor/replace-plan.ts`, `src/components/editor/ai-apply.ts` | Pure logic plus ProseMirror transactions.                                                                                               |
| OKLCH color math and the theme generator            | `src/lib/theme/color.ts`, `generate.ts`                               | No color library.                                                                                                                       |
| Emoji "exactly one" check                           | `src/lib/emoji.ts`                                                    | `Intl.Segmenter` plus a regular expression.                                                                                             |
| NDJSON stream reading                               | `src/components/ai/ai-client.ts`                                      | `fetch` + `ReadableStream` + `TextDecoder`.                                                                                             |
| AI limits and usage records                         | `src/lib/ai/usage.ts`, `limits.ts`                                    | Counted in the `ai_usage` table.                                                                                                        |
| Search ranking and snippets                         | `src/db/queries/search.ts`, `src/lib/search/`                         | `ILIKE` plus a `CASE` score; snippets returned as text segments, never HTML.                                                            |
| Task rules (status, recurrence, ordering, grouping) | `src/lib/tasks/`                                                      | Pure functions with their own tests.                                                                                                    |
| Autosave, note sync state machine                   | `src/hooks/use-autosave.ts`, `src/lib/notes/`                         | Debounce, versions, retry, drafts.                                                                                                      |
| Idea of "today"                                     | `src/lib/dates/today.ts`                                              | Built on `@date-fns/tz`.                                                                                                                |

The pattern: **libraries provide the engine; Dayboard's own small modules hold the rules.** That keeps the rules testable without a browser or a database.

---

## D. Reference tables

### Every package at a glance

**Runtime (shipped):**

| Package                                                                                           | Version       | Role                             | Files that import it           |
| ------------------------------------------------------------------------------------------------- | ------------- | -------------------------------- | ------------------------------ |
| next                                                                                              | 16.3.8        | Framework                        | many (`next/navigation` in 50) |
| react, react-dom                                                                                  | 19.3.0        | UI library                       | everywhere                     |
| better-auth                                                                                       | 1.7.7         | Authentication                   | 5                              |
| @better-auth/drizzle-adapter                                                                      | 1.7.7         | Auth ↔ database bridge           | 1                              |
| @better-auth/core, @better-auth/utils                                                             | 1.7.7 / 0.4.2 | Pinned companions of Better Auth | 0 (see below)                  |
| drizzle-orm                                                                                       | 0.45.3        | Database queries and schema      | 49                             |
| postgres                                                                                          | 3.4.9         | PostgreSQL driver                | 11                             |
| zod                                                                                               | 4.6.5         | Validation                       | 18                             |
| ai                                                                                                | ^7.0.127      | AI SDK core                      | 1                              |
| @ai-sdk/anthropic                                                                                 | ^4.0.71       | Claude connector                 | 1                              |
| @ai-sdk/google                                                                                    | ^4.0.87       | Gemini connector                 | 1                              |
| resend                                                                                            | 6.31.0        | Email delivery                   | 1 (+ tests)                    |
| server-only                                                                                       | 0.0.1         | Server/client boundary guard     | 38                             |
| tailwindcss, @tailwindcss/postcss                                                                 | 4.3.3         | Styling                          | CSS only                       |
| tw-animate-css                                                                                    | 1.4.0         | Open/close animation classes     | 1 (CSS)                        |
| radix-ui                                                                                          | 1.6.7         | Accessible primitives            | 8                              |
| class-variance-authority                                                                          | 0.7.1         | Component variants               | 1                              |
| clsx, tailwind-merge                                                                              | 2.1.1 / 3.7.0 | Class name helpers (`cn`)        | 1                              |
| lucide-react                                                                                      | 1.49.0        | Icons                            | 76                             |
| next-themes                                                                                       | 0.4.6         | Light / dark / system            | 7                              |
| sonner                                                                                            | 2.0.8         | Toasts                           | 44                             |
| cmdk                                                                                              | 1.1.1         | Command menu                     | 1                              |
| @fontsource-variable/inter                                                                        | ^5.3.0        | Self-hosted font                 | 1 (CSS)                        |
| motion                                                                                            | 14.0.0        | Animation                        | 12                             |
| @tiptap/react, /pm, /starter-kit, /extension-list, /extension-placeholder, /extension-bubble-menu | 3.31.4        | Rich-text editor                 | 8 for `@tiptap/react`          |
| @floating-ui/dom                                                                                  | ^1.8.0        | Positioning (Tiptap bubble menu) | 0 (see below)                  |
| frimousse                                                                                         | 0.4.0         | Emoji picker                     | 2                              |
| date-fns, @date-fns/tz                                                                            | 4.4.0 / 1.5.0 | Dates and time zones             | 2                              |

**Development only:**

| Package                                     | Version          | Role                                  |
| ------------------------------------------- | ---------------- | ------------------------------------- |
| typescript                                  | 6.0.3            | Type checking                         |
| eslint, eslint-config-next                  | ^9.39.5 / 16.3.8 | Linting                               |
| prettier, prettier-plugin-tailwindcss       | 3.9.9 / 0.8.1    | Formatting                            |
| husky, lint-staged                          | 9.1.7 / 17.6.0   | Commit hooks (not active yet)         |
| vitest                                      | 5.0.3            | Unit and integration tests            |
| @playwright/test, @axe-core/playwright      | 1.63.0 / 4.13.0  | Browser tests, accessibility scan     |
| drizzle-kit                                 | 0.31.11          | Migration generation, studio          |
| tsx                                         | 4.23.15          | Run TypeScript scripts                |
| esbuild                                     | 0.28.2           | Bundle the migration runner           |
| emojibase-data                              | 17.0.0           | Emoji dataset (copied into `public/`) |
| @types/node, @types/react, @types/react-dom | ^24 / ^19        | Type definitions                      |

### Declared but not imported directly

Some packages appear in `package.json` but no file in `src/` imports them. They are there for a reason:

- **`@better-auth/utils` (0.4.2):** pinned so one copy loads. The foundation hand-off notes that pnpm's default resolved a newer version and loaded **two copies**. This is recorded in the repo's own docs.
- **`@better-auth/core` (1.7.7):** a companion of `better-auth`, kept at the same version. I did not find a note explaining it, so treat the reason as inferred.
- **`@tiptap/extension-bubble-menu` and `@floating-ui/dom`:** needed by Tiptap's floating selection menu. The code imports `BubbleMenu` from `@tiptap/react/menus`, which relies on both. Declared so the versions are explicit.
- **`tsx`, `esbuild`, `drizzle-kit`, `husky`, `lint-staged`:** used as command-line tools from `package.json` scripts, not imported.
- **`emojibase-data`:** not imported either; a script copies its files into `public/`.

### Gotchas that have already cost time

All of these are recorded in the repo's hand-off notes or visible in the code:

1. **Better Auth's `listSessions` and `unlinkAccount` demand a session younger than 10 minutes.** Calling them from a page crashed Settings for longer-signed-in users. The app reads sessions from the table and checks freshness itself.
2. **Drizzle schema files must use relative imports**, because `drizzle-kit` doesn't know the `@/` alias.
3. **`drizzle.config.ts` loads `.env.local` itself**, because `drizzle-kit` does not.
4. **Never send raw ProseMirror JSON to a Server Action.** Node attributes have no prototype and get dropped (headings refused, ticked checklist items saved as unticked). The editor round-trips the document through JSON first.
5. **Radix menus that open something else must do it from `onCloseAutoFocus`**, after the menu has finished closing, or the new thing dismisses itself immediately. This was hit again with Writing help.
6. **Tiptap's floating menu removes itself from the page when the editor loses focus**, so a Radix dropdown anchored to it needs to render inside it (fixed with the `container` prop on `DropdownMenuContent`).
7. **`next dev` and tests must not share a build folder.** That's why `distDir` is configurable (`.next-e2e`).
8. **`server-only` throws outside a Next build**, so tests alias it to a stub.
9. **Port clashes:** if the dev server starts on a different port, `BETTER_AUTH_URL` and `NEXT_PUBLIC_APP_URL` must match it or auth rejects requests.
10. **A leftover test server can hold port 3100** and make Playwright fail to start.

### Verified versus not yet verified

- **Verified in this review:** the package list and versions, the config files, how each library is wired, and the request flows traced above (by reading the code).
- **Documented as tested by earlier work:** unit, integration and browser suites, run against the mock AI and console email.
- **Not verified end to end:** real Google and GitHub sign-in, real Resend delivery, real Anthropic or Gemini calls (tests use the mock only), and the Dockerfile and Compose files (Docker is not installed on the development machine, so they have not been run there).

### What does not exist yet

CI and CD workflows, `.github/`, Caddy and HTTPS, `docker-compose.prod.yml`, backup and rollback scripts, active Husky hooks, and vector or full-text search. The first group is feature 06; the last is planned for V2.

---

## Where to look next

| If you want to understand…   | Start here                                              |
| ---------------------------- | ------------------------------------------------------- |
| Who is signed in, everywhere | `src/lib/session.ts`, `src/lib/auth.ts`                 |
| How a write is made safe     | `src/lib/actions.ts`, then any file in `src/actions/`   |
| The database shape           | `src/db/schema/`, `drizzle/migrations/`                 |
| The AI pipeline              | `src/lib/ai/gate.ts`, `index.ts`, `providers/`          |
| The design system            | `DESIGN.md`, `src/styles/globals.css`, `src/lib/theme/` |
| The editor                   | `src/components/editor/`, `src/lib/editor/`             |
| The tests                    | `tests/`, `e2e/`, `playwright.config.ts`                |
| What was built and why       | `agent_docs/`, `docs/decisions/`                        |

**Official documentation** (from the project's technical spec): [Next.js](https://nextjs.org/docs), [Tailwind CSS](https://tailwindcss.com/docs), [shadcn/ui](https://ui.shadcn.com/docs), [Tiptap](https://tiptap.dev/docs/editor), [Better Auth](https://better-auth.com/docs), [Drizzle ORM](https://orm.drizzle.team/docs), [Motion](https://motion.dev/docs/react), [Vitest](https://vitest.dev/guide/), [Playwright](https://playwright.dev/docs/intro), [Docker](https://docs.docker.com/).
