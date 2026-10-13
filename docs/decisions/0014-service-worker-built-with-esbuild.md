# 0014. Service worker written by hand and bundled with esbuild

**Status:** Accepted
**Date:** 2026-10-13
**Phase:** V2

## Context

V2 feature 03 (`specs/v2/features/03-pwa-shell-and-install.md` §3) adds a service worker so the installed app opens offline. The spec names Serwist as the first option, but asks us to verify that its Next.js integration supports this project before choosing it. This project runs Next 16.3 with Turbopack as the default bundler. `@serwist/next` is a webpack plugin. Our search found no clear statement that it works with Turbopack builds. Some sources say production builds work, others say dev does not, and none were official. The `@serwist/turbopack` package named in our search does not show up in the npm registry under that name, so we could not confirm it.

## Decision

Write the worker by hand in `src/sw/sw.ts` and bundle it with **esbuild** (already a dev dependency, used by `build:migrate`) into `public/sw.js` in a `build:sw` script that runs in `prebuild`. The build injects a build id, so every deploy produces a worker that differs from the last one. The pure caching rules live in `src/sw/policy.ts` so they can be unit-tested without a browser. No new runtime or dev dependency is added.

## Alternatives

- **Serwist (`@serwist/next`).** Less code to maintain, with precache manifests and strategies built in. Rejected for now: the webpack-based integration does not clearly fit a Turbopack build, and the spec's own note asks us to verify this first. Adding a dependency we cannot confirm works would be worse than a small worker we can read in full. Revisit if Serwist documents Turbopack support.
- **Workbox directly.** Same bundler question, and a larger dependency than the handful of strategies we need.
- **`next-pwa` and similar.** Abandoned or tied to webpack.

## Deviation from the feature spec: no navigation timeout

`specs/v2/features/03-pwa-shell-and-install.md` §3 asks for "network first with a 3 s timeout" before the offline shell is shown. We do not time out. The offline shell appears when the network request **fails**. A timeout would show "You're offline" to a person who is online whenever the server is slow (a database waking from idle, a cold start). That is worse than waiting. A connection that hangs without failing still shows the browser's own loading state until it fails.

## Consequences

- We own the worker's caching code. The policy is small and tested (`tests/unit/sw-policy.test.ts`), and the worker itself is covered by E2E (`e2e/offline-shell.spec.ts`).
- `public/sw.js` is generated and git-ignored. `next dev` does not register it (see the spec §3), so dev stays free of stale caches.
- The worker is served from `/sw.js` with `Cache-Control: no-cache` and `Service-Worker-Allowed: /` (set in `next.config.ts`).
- The offline shell appears on a failed request, not on a slow one (see the deviation above).
- If we later move to a bundler that Serwist supports, only `scripts/build-sw.mjs` and the build wiring change.
