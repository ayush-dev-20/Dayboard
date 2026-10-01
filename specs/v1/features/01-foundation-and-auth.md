# Feature 01 — Foundation & Auth

## 1. Scope

This feature builds the running skeleton of the app. Everything else builds on it.

- Repository scaffold, tooling and environment validation
- PostgreSQL + Drizzle base setup and migration workflow
- Authentication with **Better Auth**: email/password, Google, GitHub and magic link
- Transactional email (verification, password reset, magic link)
- Protected app shell: sidebar, mobile nav, top bar, theme
- Settings: account, connected sign-in methods, appearance, productivity preferences, AI toggle, delete account
- Shared server helpers: `requireUser()`, error model, logger, correlation ID

Source spec sections: product §6.1, §10, §11 Journey A; technical §1–4, §7–9, §16–18; UI/UX §3, §21, §22; project plan Phases 0–1.

---

## 2. Auth provider decision

**Chosen: Better Auth** (open-source TypeScript auth library, self-hosted in our own PostgreSQL).

| Option | Verdict | Reason |
|---|---|---|
| Better Auth | **Chosen** | Runs inside our Next.js app, stores users/sessions in our Postgres through Drizzle, and costs nothing. It has first-party plugins for OAuth, magic link, rate limiting and later 2FA/passkeys. It fits the single-VM Docker architecture and the DevOps learning goals. |
| Clerk | Rejected | User data lives on Clerk's servers, users must be synced into our DB by webhook, it costs money past the free tier, and it adds an external hard dependency to local dev and CI. |
| Auth.js / NextAuth | Rejected | In maintenance mode since its maintainers joined Better Auth (2025). It gets security fixes only, and its maintainers recommend Better Auth for new projects. |

Pin the exact `better-auth` version in the lockfile. Use the import paths documented for that pinned version (the Drizzle adapter path has moved between releases).

---

## 3. Sign-in methods

| Method | Sign up | Sign in | Needs email delivery | Notes |
|---|---|---|---|---|
| Email + password | ✅ | ✅ | Yes (verification, reset) | Min 10 chars, max 128. No composition rules. |
| Google | ✅ | ✅ | No | OAuth 2.0 / OIDC. Email arrives pre-verified. |
| GitHub | ✅ | ✅ | No | Request the `user:email` scope so we get the verified primary email. |
| Magic link | ✅ (creates account on first use) | ✅ | Yes | Link valid 10 minutes, single use. |

### Account linking

A person has **one user account** no matter how they sign in.

- Enable Better Auth account linking with `trustedProviders: ["google", "github"]`.
- If someone signs in with Google/GitHub using an email that already has an account, the provider is linked to that account automatically. This is safe only because both providers return verified emails.
- A magic-link sign-in for an existing email signs into that existing account.
- A user can link and unlink providers in Settings → Account → Sign-in methods. **They can never remove their last sign-in method.** The server rejects this with `CONFLICT`.
- A user who signed up with OAuth or magic link has no password. They can set one from Settings. The set-password action needs a fresh session (signed in within the last 10 minutes).

### Email verification

- Email/password sign-ups must verify their email before reaching the app (`requireEmailVerification: true`), **when email delivery is configured**.
- OAuth and magic-link users are verified by definition.
- In development with no email provider configured, emails are logged to the server console instead of sent, and verification is not enforced. This keeps local setup to zero config.
- In production, email delivery is **required**: magic link and password reset can't work without it. Startup env validation fails if `NODE_ENV=production` and the email variables are missing.

---

## 4. Better Auth configuration

File: `src/lib/auth.ts` (server-only; starts with `import "server-only"`).

```ts
export const auth = betterAuth({
  appName: "Dayboard",
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: { database: { generateId: "uuid" } },   // one ID strategy app-wide

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    requireEmailVerification: env.EMAIL_ENABLED,
    sendResetPassword: async ({ user, url }) => sendEmail(resetPasswordEmail(user, url)),
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => sendEmail(verifyEmail(user, url)),
  },
  socialProviders: {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET },
  },
  account: {
    accountLinking: { enabled: true, trustedProviders: ["google", "github"] },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,   // 30 days
    updateAge: 60 * 60 * 24,        // refresh expiry at most once a day
    freshAge: 60 * 10,              // "recently signed in" window, see §9
  },
  user: {
    deleteUser: { enabled: true },  // app-level re-auth check, see §9
  },
  rateLimit: { enabled: true, storage: "database" },
  databaseHooks: {
    user: { create: { after: async (user) => createDefaultPreferences(user.id) } },
  },
  plugins: [
    magicLink({ expiresIn: 600, sendMagicLink: async ({ email, url }) => sendEmail(magicLinkEmail(email, url)) }),
    nextCookies(),                  // must be last
  ],
});
```

This is the target shape, not copy-paste code. Check option names against the pinned version's docs.

- A social provider is registered only when both its env vars are set. The sign-in page hides buttons for unconfigured providers. That way local dev works with no OAuth apps.
- Rate limit storage is `database` so limits survive container restarts during deploys.
- Route handler: `src/app/api/auth/[...all]/route.ts` → `export const { GET, POST } = toNextJsHandler(auth)`.
- Client: `src/lib/auth-client.ts` → `createAuthClient({ plugins: [magicLinkClient()] })`. The client holds no secrets.

### OAuth app setup (documented in README)

| Provider | Authorized redirect URI |
|---|---|
| Google (Cloud Console → OAuth client, type "Web") | `{BETTER_AUTH_URL}/api/auth/callback/google` |
| GitHub (Settings → Developer settings → OAuth Apps) | `{BETTER_AUTH_URL}/api/auth/callback/github` |

Use separate OAuth apps for local (`http://localhost:3000`) and production. GitHub OAuth apps allow only one callback URL each.

---

## 5. Email delivery

- Provider: **Resend**, behind a small `EmailSender` interface in `src/lib/email/`. This matches the replaceable-adapter pattern used for AI.
- Implementations: `ResendEmailSender` (production) and `ConsoleEmailSender` (dev/test: logs the recipient, subject and link). Selected by whether `RESEND_API_KEY` is set.
- Templates: verify email, reset password, magic link. Plain, calm HTML with a text fallback. No tracking pixels.
- Never log full email bodies in production. Only log the template name and a hashed recipient.
- The sending domain needs SPF/DKIM records (documented in the DevOps README section).

---

## 6. Environment variables

Validated at startup by `src/lib/env.ts` (Zod). Missing required values crash startup with a clear message.

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | |
| `DATABASE_URL` | yes | |
| `BETTER_AUTH_SECRET` | yes | ≥ 32 random bytes. Generate with `openssl rand -base64 32`. |
| `BETTER_AUTH_URL` | yes | Public origin, e.g. `https://app.example.com` |
| `NEXT_PUBLIC_APP_URL` | yes | Same origin, used in client links |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | optional pair | Both or neither |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | optional pair | Both or neither |
| `RESEND_API_KEY` | required in production | Absent in dev → console sender |
| `EMAIL_FROM` | required when `RESEND_API_KEY` is set | e.g. `Dayboard <hello@example.com>` |

AI variables are defined in feature 05.

---

## 7. Data model

### Better Auth tables (generated)

Generate the Drizzle schema with the Better Auth CLI (`auth generate --adapter drizzle`), commit it under `src/db/schema/auth.ts`, then create a normal Drizzle migration. Don't hand-edit generated columns. Add app data in separate tables.

| Table | Purpose |
|---|---|
| `user` | id, name, email (unique), email_verified, image, timestamps |
| `session` | token, user_id, expires_at, ip_address, user_agent |
| `account` | one row per sign-in method: provider_id (`credential`, `google`, `github`), account_id, hashed password for `credential` |
| `verification` | email verification, password reset and magic-link tokens |
| `rate_limit` | Better Auth rate-limit counters |

### `user_preferences` (app-owned)

| Column | Type | Notes |
|---|---|---|
| `user_id` | uuid PK, FK → user.id cascade | one row per user, created by the `user.create.after` hook |
| `theme` | enum `light` \| `dark` \| `system` | default `system` |
| `timezone` | text | IANA name, e.g. `Asia/Kolkata`. Auto-detected from the browser at onboarding. **Required for "due today" / "overdue" logic** in features 02 and 04. |
| `default_task_priority` | enum | default `NONE` |
| `start_of_day` | time | default `06:00`. "Today" rolls over at this local time. |
| `week_start` | smallint 0–6 | default 1 (Monday) |
| `ai_enabled` | boolean | default true |
| `focus_task_id` | uuid NULL | set in feature 04. Declared here to avoid a migration later. |
| `onboarded_at` | timestamptz NULL | |
| `created_at` / `updated_at` | timestamptz | |

All later feature tables reference `user.id` with `ON DELETE CASCADE`. That cascade is what makes account deletion complete (§9).

---

## 8. Server contract

### Shared helpers

| Helper | Location | Behavior |
|---|---|---|
| `getSession()` | `src/lib/session.ts` | `auth.api.getSession({ headers: await headers() })`, wrapped in React `cache()` so it runs once per request. |
| `requireUser()` | same | Returns `{ id, email, name }` or throws `UNAUTHENTICATED`. In Server Components it redirects to `/sign-in?next=<path>`. **The only allowed source of `userId` for any query or mutation.** |
| `AppError` + `toErrorResponse()` | `src/lib/errors/` | Typed codes from technical spec §17. |
| `logger` | `src/lib/logger.ts` | JSON to stdout in production, pretty output in dev. Adds the correlation ID. Redacts `password`, `token`, `secret`, `authorization`, `cookie`. |

### Route protection

- `src/proxy.ts` (the Next.js 16 replacement for middleware) does an **optimistic cookie-presence check** only. No session cookie on an `(app)` route → redirect to `/sign-in`. It never makes the real access decision.
- The real check is `requireUser()` in every page, layout, Server Action and Route Handler (technical spec §7, Agent.md §5).

### Auth routes (pages)

| Route | Purpose |
|---|---|
| `/sign-in` | Email + password form, "Email me a sign-in link", Google and GitHub buttons |
| `/sign-up` | Name, email, password + the same OAuth buttons |
| `/verify-email` | "Check your inbox" + resend (rate-limited) |
| `/forgot-password` → `/reset-password?token=` | Reset flow |
| `/magic-link-sent` | Confirmation screen |
| `/onboarding` | One screen: confirm name, timezone (pre-filled), theme. Sets `onboarded_at`. |

Redirect rules: signed-in users visiting auth pages go to `/today`. After sign-in, go to the validated `next` param (same-origin relative paths only, to prevent open redirects), otherwise `/onboarding` if not yet onboarded, otherwise `/today`.

### Settings actions (`src/actions/settings.ts`)

| Action | Input (Zod) | Notes |
|---|---|---|
| `updateProfile` | `{ name: string 1–80 }` | |
| `updatePreferences` | partial of `user_preferences` editable fields | Timezone validated against `Intl.supportedValuesOf("timeZone")` |
| `changeEmail` | via Better Auth `changeEmail` | Sends verification to the new address |
| `setPassword` / `changePassword` | via Better Auth | `changePassword` revokes other sessions |
| `linkProvider` / `unlinkProvider` | provider id | Unlinking the last method → `CONFLICT`. Unlinking needs a session under 10 minutes old (Better Auth requires it); otherwise the UI shows "Sign in again" |
| Sessions list / `revokeSession` / `revokeOtherSessions` | session id | The list is read from the `session` table by `db/queries/sessions.ts`, scoped to the signed-in user and never selecting the token. Better Auth's own `listSessions` is **not** used: it requires a session under 10 minutes old, which would break Settings for anyone signed in longer. Revoking looks the token up by id **and** owner |
| `deleteAccount` | `{ confirmation: "DELETE" }` | See §9 |

---

## 9. Account deletion

1. Settings → Danger zone → "Delete account".
2. The user must have a **fresh session** (signed in within 10 minutes). If not, they're asked to sign in again with any linked method. This works the same for password, OAuth and magic-link users.
3. They type `DELETE` to confirm.
4. The server deletes the `user` row. FK cascades remove sessions, accounts, preferences and all workspace data (tasks, todos, notes, projects, tags, inbox items, AI usage).
5. Signed out → marketing/sign-in page with a short confirmation.

Retention policy: deletion is immediate and hard in the live DB. Rows can persist in DB backups until those backups rotate out (feature 06). The Settings data-processing notice says this.

---

## 10. App shell & UI

Components (UI/UX spec §25): `AppShell`, `Sidebar`, `MobileNav`, `TopBar`, `PageHeader`, `EmptyState`, `ErrorState`, `ConfirmDialog`, the Sonner `Toaster`, and `ThemeProvider` (next-themes).

- Sidebar items as in product spec §5. Pages not built yet render an `EmptyState` "coming soon" placeholder, so navigation is complete from day one.
- Settings uses top tabs (Account, Appearance, Productivity, AI; Tags joins in feature 03) with Danger zone inside Account, as in `designs/Settings.html`. The AI tab shows the switch and data notice; the usage meter comes with feature 05.
- Auth screens: a single centered column, max width ~400px, built from shadcn `Card`-free form primitives (calm, not boxed). OAuth buttons sit above the email form, separated by an "or" divider.
- Every auth form: labels, inline field errors, `aria-live` for form-level errors, submit disabled while pending, and Enter submits.
- Error copy never reveals whether an email exists. For example: "If an account exists for that email, we've sent a link."

---

## 11. Security rules

- Rate limits (Better Auth, database storage): sign-in, sign-up, forgot-password and magic-link requests get tight limits (5 per minute per IP; 3 for reset, magic link and resend), and all other auth endpoints get general limits (60 per minute). Limits are keyed by the client IP in `X-Forwarded-For`. With no such header every visitor shares one bucket, so Caddy must set it and the app must be reachable only through Caddy (feature 06). The magic-link plugin adds its own limit on its verify endpoint.
- Cookies: `HttpOnly`, `Secure` in production, `SameSite=Lax` (Better Auth defaults). Caddy terminates TLS, so `BETTER_AUTH_URL` must be the `https://` origin, and the app must trust `X-Forwarded-*` from Caddy only.
- Better Auth's built-in origin check on state-changing requests stays on. `trustedOrigins` contains only the app origin.
- Never log passwords, tokens, magic-link URLs, OAuth codes or cookies.
- Passwords are hashed by Better Auth (scrypt). Never implement custom hashing.

---

## 12. Repository foundation (Phase 0)

- Next.js 16 App Router, TypeScript strict, pnpm, Node 24 LTS (`.nvmrc` + `engines`)
- Tailwind v4 + shadcn/ui initialized with the semantic tokens from UI/UX spec §4
- ESLint, Prettier, Husky + lint-staged
- Scripts: `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `db:studio`, `db:seed`
- `docker-compose.yml` with a `db` service for local Postgres (feature 06 extends it)
- `GET /api/health` returning `{ status: "ok" }` with a lightweight `SELECT 1`
- Seed script: one demo user (email/password `demo@dayboard.local`), development only

---

## 13. Tests

**Unit (Vitest)**
- `env.ts`: production without email vars fails; optional provider pairs must be both-or-neither
- `requireUser()` throws/redirects without a session
- `next` redirect sanitizer rejects absolute and protocol-relative URLs
- Unlinking the last sign-in method is rejected

**E2E (Playwright)**. OAuth is not exercised against real providers in CI.
1. Sign up with email/password → verification email captured from the console sender → verify → onboarding → Today
2. Sign out → sign in → Today
3. Forgot password → reset via captured link → old sessions revoked
4. Magic link: request → captured link → signed in; reusing the link fails
5. Unauthenticated visit to `/today` → redirected to `/sign-in?next=/today`
6. User A cannot read user B's preferences through any action (ownership test harness reused by later features)
7. Delete account → user and all rows gone → cannot sign in

Each test runs with its own client IP (`x-forwarded-for`) so parallel tests don't share rate-limit buckets and the real limits stay on; one test proves the sixth failed sign-in in a minute is refused.

OAuth callback handling is covered by one manual checklist item per provider in the launch checklist (see the README).

---

## 14. Definition of done

- [ ] All four sign-in methods work locally. Google/GitHub are verified manually with real OAuth apps.
- [ ] Linking a provider to an existing email account results in one user, not two
- [ ] Email verification, password reset and magic link work with Resend in a staging/prod-like environment
- [ ] Unauthenticated access to any `(app)` route or action is rejected server-side
- [ ] Settings: profile, preferences, sign-in methods, sessions and delete account all work
- [ ] App shell responsive down to 360px, keyboard-navigable, light/dark/system theme
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm build` pass
- [ ] `.env.example` and README document every variable and the OAuth setup steps

---

## 15. Out of scope (V1)

- 2FA / TOTP, passkeys, SSO/SAML, Apple/Microsoft sign-in (Better Auth plugins make these easy additions in V2)
- Organizations/teams
- Admin panel / user impersonation
- CAPTCHA (add only if sign-up abuse appears)
