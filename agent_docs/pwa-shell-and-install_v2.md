# Feature: PWA shell and install

**Phase:** V2 (feature 03)
**Status:** In progress. The offline worker, the offline shell, the manifest and icons, the online indicator, the update banner and the install UI are built. Still open: the skew protection (`x-app-version` / `426`), a real install on iOS and Android, and a real redeploy test of the update banner.
**Date:** 2026-10-13

## What was built

- **A service worker** (`src/sw/sw.ts`, built to `public/sw.js` by `scripts/build-sw.mjs` in `prebuild`). Page loads go network first and fall back to a shell page only when the request fails. Build files and public assets are served from cache and refreshed in the background. `/api/*`, writes and anything `no-store`, `private` or with a cookie are never stored.
- **An offline shell** (`/offline`, static, no account data). The worker keeps it, and the scripts and styles it links, so it draws when there is no connection.
- **A manifest** with the full member set (`id`, `scope`, `start_url: /today?source=pwa`, `display_override`, categories, four shortcuts), PNG icons at 96, 192, 512 and a maskable 512 (`/icons/*`, drawn from the brand mark by `src/lib/pwa/icon-art.tsx`).
- **Install UI:** Settings → App shows the state (installed, can install, iOS steps, use the browser menu, or unsupported). A once-only install tip appears on Today on the third app open. "Not now" keeps it away for 90 days.
- **Online indicator:** "Offline" in the top bar while the browser reports no connection.
- **Update banner:** "A new version is ready." It never reloads on its own. It shows "Reload when you finish" while any autosaving editor has unsaved changes (`src/lib/pwa/unsaved.ts`, fed by `useAutosave`).
- **Sign-out** removes every cache the worker made (`clearWorkerCaches`, called by both sign-out buttons).

## Why

Feature 04 (offline data) needs an installed app that opens with no network. The worker is the piece that makes that possible, and it has to be built first. Decision and alternatives: `docs/decisions/0014-service-worker-built-with-esbuild.md`.

## What was deferred

- **Skew protection** (spec §5): the `x-app-version` header and the `426 APP_OUTDATED` answer. Not built. Nothing in the server checks versions yet.
- **Screenshots** in the manifest (optional in the spec). Not built.
- **Install on real devices:** the Chrome install dialog, Android shortcuts, iOS "Add to Home Screen" and a standalone launch are all manual checks. None has been done yet.
- **Real redeploy test** of the update banner. The banner logic is unit-tested, and the browser test covers only the shell, not a second worker version.
- **Push events** are placeholders for feature 14 (listeners present, no behaviour).
- An iOS diagram in Settings → App (the spec mentions one). Text steps only.

## Deviations from the feature spec

- **No 3-second timeout on navigations.** The spec asks for one. We fall back only when the request fails, because a slow but working server would otherwise show "You're offline" to an online person (ADR 0014).
- **Own worker, not Serwist.** See ADR 0014. The build is esbuild, as for `build:migrate`. No new dependency.

## Related files

- `src/sw/sw.ts`: the worker (install, activate, fetch, message).
- `src/sw/policy.ts`: the caching rules, as pure functions (`classify`, `isStorable`, `shellAssetPaths`, `cacheNames`).
- `scripts/build-sw.mjs`: bundles the worker with a build id.
- `next.config.ts`: `/sw.js` headers (`Cache-Control: no-cache`, `Service-Worker-Allowed: /`).
- `src/app/offline/page.tsx`: the offline shell.
- `src/app/manifest.ts`, `src/app/icons/*`, `src/lib/pwa/icon-art.tsx`: manifest and icons.
- `src/components/pwa/`: `register-service-worker.tsx`, `update-banner.tsx`, `use-waiting-worker.ts`, `install-tip.tsx`, `use-install.ts`, `record-visit.tsx`.
- `src/lib/pwa/`: `install.ts` (rules), `install-prompt.ts` (Chromium's offer), `visits.ts` (localStorage counters), `update.ts`, `unsaved.ts`, `use-online-status.ts`, `clear-caches.ts`.
- `src/components/settings/app-install-section.tsx` and `src/app/(app)/settings/app/page.tsx`: Settings → App.
- Tests: `tests/unit/sw-policy.test.ts`, `pwa-install.test.ts`, `pwa-update.test.ts`, `manifest.test.ts`; `e2e/offline-shell.spec.ts`, `e2e/pwa-install.spec.ts`.

## Hand-off notes

- **Playwright runs the production build** (`pnpm build`, then `next start`). `next dev` never registers the worker, so test the offline behaviour with a build.
- **The shell is precached at install time**, from the `/offline` HTML. If the shell cannot be fetched during install, the install fails and the old worker (or none) stays. That is intentional.
- **After sign-out, the shell is rebuilt on the next online page load** (`ensureShell`). Until then, going offline shows the browser's own error page.
- **Only waiting workers are offered.** A new worker waits until the page asks (`SKIP_WAITING`); a first install activates straight away.
- **Feature 04 depends on this.** It needs the worker to answer failed navigations with the offline app, and needs ADR 0006 (routing) before it builds that.
- The install tip counts app opens per browser session (`sessionStorage` guard), so a refresh does not count again. It appears only when the count is exactly 3.
- Related: `multiple-views_v2.md`, `files-attachments-and-bookmarks_v2.md`, `nested-notes-links-sidebar-tree_v2.md` and `ai-workspace-assistant_v2.md` (all written while 03 to 05 were skipped; the status lines there are now updated).
