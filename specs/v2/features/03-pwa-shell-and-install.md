# Feature 03 — PWA Shell & Install

## 1. Scope

- A working **service worker** with a safe caching policy
- A complete **web app manifest** and icon set (192, 512, maskable), plus app shortcuts
- An **install experience**: a quiet install card, iOS instructions, an "installed" state
- An **offline app shell**: the installed app opens without a network and shows what is available
- An **update-available prompt** that never interrupts work or leaves the person on a broken version
- A quiet **online/offline indicator** hook (the full sync status comes in 05)
- Clean-up of cached and local data on sign-out
- A placeholder for push events in the service worker (filled in by 14)

What exists today: `src/app/manifest.ts` (name, `standalone`, `start_url: /today`, colours, an SVG icon and a 180px Apple icon). There is **no service worker**, no install UI, no 192/512px PNG or maskable icon.

Source spec sections: product §4, §13 (offline status visible but quiet), §2.1 row 1; technical §2; project plan Phase 1.

Not here: reading and writing data offline (04), queued sync (05), push (14). This feature only guarantees that the app **launches** offline and explains what works.

---

## 2. Data model

None on the server. Client-side:

| Where | What |
|---|---|
| Cache Storage | `dayboard-shell-<buildId>` (precache), `dayboard-static-<buildId>` (runtime static) |
| `localStorage` | `pwa:installDismissedAt`, `pwa:visitCount` (count of app opens, for the install tip) |
| Cookie (functional) | none |

`buildId` is `process.env.APP_VERSION` or the Next build id. Old caches are deleted when a new worker activates.

---

## 3. Service worker

**Build.** ADR 0014 first. Serwist's Next.js integration targets webpack builds; this project uses Next 16. Verify current support. If the pinned integration does not support the build, write the worker as `src/sw/sw.ts` and bundle it with esbuild in a `build:sw` script (the same pattern as `build:migrate`), emitting `public/sw.js`. Either way the worker is served from `/sw.js`, scope `/`, with `Cache-Control: no-cache` and `Service-Worker-Allowed: /`.

**Registration.** A client component `RegisterServiceWorker` in the root layout registers `/sw.js` after load (`window.addEventListener("load")`), only in production builds or when `NEXT_PUBLIC_SW=1` (off in `next dev`, because a dev worker caches stale modules). Unsupported browsers skip silently and the app behaves exactly as today.

**Caching policy** (the product rule: never cache authenticated data indiscriminately):

| Request | Strategy |
|---|---|
| Next static assets (`/_next/static/*`), fonts, `/brand/*`, `/emojibase/*`, icons | **Precache** the shell list at install; others cache-first with revalidation |
| Navigation requests (HTML) | **Network first** with a 3 s timeout; on failure serve the **offline shell** (below), never a stale authenticated page |
| `/api/*` (health, auth, ai, search, sync, files) | **Never cached**; network only |
| Server Action POSTs | Never intercepted |
| Responses with `Cache-Control: no-store` or `private` | Never stored |
| Cross-origin requests (storage, OAuth) | Not intercepted |

**Offline shell.** `/offline` is a statically rendered route, precached, with no per-user data. On a failed navigation the worker returns it. Until feature 04 it shows: the app name, "You're offline", the list of what will work offline once 04 ships ("Tasks, todos and notes you have opened will be available"), and a **Try again** button. After 04 the same route boots the local app (ADR 0006), reading the local database. The route works for a signed-out visitor too (it never shows account data).

**Security.** The worker never stores `Set-Cookie` responses or HTML containing a signed-in session's data. The precache lists only static, public files.

**Push placeholder.** `self.addEventListener("push", …)` and `notificationclick` are present as no-ops with a comment; feature 14 implements them.

**Versioning.** Each worker file embeds the `buildId`. `skipWaiting` is **not** called automatically (see §5). `clients.claim()` is called on activate so the new worker controls open pages only after the person reloads, not mid-edit.

---

## 4. Manifest and icons

Extend `src/app/manifest.ts`:

- `id: "/"`, `scope: "/"`, `start_url: "/today?source=pwa"`, `display: "standalone"`, `display_override: ["standalone", "minimal-ui"]`, `orientation: "any"`, `categories: ["productivity"]`, `lang: "en"`, `theme_color` and `background_color` from the generated tokens (light), a `description`.
- **Icons:** keep the SVG; add PNG 192×192 and 512×512 (`purpose: "any"`) and a **maskable** 512×512 (`purpose: "maskable"`, brand mark inside the safe zone). Generate them from the brand mark without a new dependency: Next `ImageResponse` route handlers (`/icons/192`, `/icons/512`, `/icons/maskable`), the same technique as `apple-icon.tsx`, with long `Cache-Control`.
- **Shortcuts** (long-press on the app icon): New task (`/tasks?focus=add`), New note (`/notes/new`), Quick capture (`/today?capture=1`), Search (`/search`). Each with a 96px icon.
- A dark `theme_color` is applied with `<meta name="theme-color" media="(prefers-color-scheme: dark)">` in the layout (manifests have one colour).
- **Screenshots** (optional, improves the Chrome install dialog): wide and narrow images from the marketing set.
- iOS: `appleWebApp` metadata (`capable`, status bar style) and the 180px touch icon (exists).

A unit test parses the generated manifest and checks the required members.

---

## 5. Install and update UX

### Install

- **Hook** `useInstall()`: captures `beforeinstallprompt` (Chromium), exposes `canInstall`, `install()`, `installed` (`display-mode: standalone` media query or `navigator.standalone` on iOS), and `platform` (`chromium | ios | other`).
- **Settings → App** (new tab `/settings/app`): shows install state. If installable: "Install Dayboard" button. If iOS Safari: instructions with the Share and "Add to Home Screen" steps, with a small diagram (no emoji, DESIGN.md). If already installed: "Installed on this device." If unsupported: "Your browser can't install apps, but Dayboard works in the browser."
- **Install tip** on Today: after the **third** visit (counted in `localStorage`), once, a dismissible quiet card "Install Dayboard for quick access and offline use" with **Install** and **Not now** (dismissal remembered 90 days; never shown when installed or unsupported). It is not a growth mechanic: no repeat prompts, no badge.
- Install events are not sent anywhere.

### Update available

- When a new worker is installed and waiting, show a quiet banner in the shell: "A new version is ready. **Reload**". It never auto-reloads.
- **Reload** posts `SKIP_WAITING` to the waiting worker, then reloads on `controllerchange`.
- If the person has **unsaved state** (a note save pending or failed; an open dialog with edits), the reload button is replaced by "Reload when you finish" until the state clears. Use the same dirty signal as the beforeunload guard.
- If the new worker fails to activate, the old one keeps controlling; the banner is hidden and an error is logged (no user-facing alarm).
- **Skew protection:** every request from the app sends `x-app-version`. The server keeps accepting the previous release's version. If a client is older than the supported window, the API answers `426`/`APP_OUTDATED` and the app shows the update banner as a requirement ("Reload to continue").

### Online/offline indicator (base)

- Hook `useOnlineStatus()` (browser `online`/`offline` events plus a failed-fetch signal) used by later features.
- A **quiet** indicator in the top bar: nothing when online; a small dot and "Offline" text when offline (never red; colour is not the only signal). The sync status in 05 extends it.

---

## 6. Sign-out and shared devices

On sign-out (and on account deletion):

- Delete all Cache Storage entries created by the worker.
- Tell the worker to drop runtime caches (`postMessage({ type: "CLEAR" })`).
- Feature 04 additionally clears the local database after checking for unsynced changes.
- The offline shell shows no account data, so a stale cache cannot reveal a previous person's information.

---

## 7. Tests

**Unit**
- Manifest members (name, icons incl. maskable and 512, shortcuts, `start_url`, `id`).
- `useInstall` state machine with a fake `beforeinstallprompt` event; iOS UA detection.
- Cache policy matcher: which requests are precached, networked, never cached (`/api/*`, `no-store`).
- Update-banner logic: waiting worker, dirty state defers reload.

**E2E** (Chromium; some cases flagged "where automation supports it")
1. In a production build, `navigator.serviceWorker.ready` resolves and `/sw.js` is served with the right headers.
2. After one online load, `context.setOffline(true)` and a navigation to `/today` shows the offline shell with "You're offline" and no account data; **Try again** works when back online.
3. `/api/*` and an authenticated page are not in Cache Storage.
4. The manifest is linked, valid, and its icons return 200 with the right size and type.
5. Settings → App shows the right state; the install tip appears on the third visit once and not again after dismissal.
6. Update flow: install a second worker version (test build id), see the banner, defer while a note is dirty, reload when clean.
7. Sign-out clears Cache Storage.
8. No console errors from the worker; reduced-motion and axe pass on the new UI.

**Manual (written into the as-built doc):** Chrome desktop install prompt, Android Chrome install and shortcuts, iOS Safari "Add to Home Screen" launches standalone, installed app opens offline, update banner on a real redeploy.

---

## 8. Definition of done

- [ ] The app installs from Chromium and from iOS Safari, launches standalone, and has proper PNG and maskable icons and shortcuts
- [ ] After one successful load, the installed app launches **offline** and shows the offline shell; it never shows another person's data
- [ ] A new deployment shows the update banner; reloading is never forced; a failed update never leaves a broken app
- [ ] The service worker never caches `/api/*`, server actions, `no-store` or authenticated HTML
- [ ] Sign-out clears the caches
- [ ] Unsupported browsers see no change and no errors
- [ ] `pnpm lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build`, `check:bundle` pass; the production build includes `sw.js`
- [ ] `agent_docs/pwa-shell-and-install_v2.md` written and indexed (including the Serwist-or-custom decision and the manual checklist results)

---

## 9. Out of scope (V2)

Offline reading and writing of data (04); background sync and retry (05); push notifications (14); periodic background sync; app badging; file handlers and share targets; an in-app install marketing page; native store listings.
