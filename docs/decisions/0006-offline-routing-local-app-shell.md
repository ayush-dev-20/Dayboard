# 0006. Offline routing: one precached local app shell for the offline screens

**Status:** Accepted
**Date:** 2026-10-13
**Phase:** V2

## Context

V2 feature 04 (`specs/v2/features/04-local-persistence-and-offline.md` §5) needs the installed app to open and work with no network. Every page of the App Router is rendered on the server, and every navigation asks the server for a React Server Component payload. A cache of pages cannot make those pages work offline, because a page needs data the browser does not have, and cached payloads would hold account data on a shared device. Feature 03 already gives us a service worker that answers a failed page load with `/offline`.

## Decision

- **Online, nothing changes.** The app stays server-rendered exactly as in V1.
- **One static local app shell,** `/local`, is prerendered and precached by the service worker. It holds no data. It is a client-only React page that reads `location.pathname` and renders the matching offline screen from the local database (`src/lib/local/`).
- **Inside the shell, navigation is the shell's own.** Links use `history.pushState` and a small client router, not the App Router. The Next router is not asked for a page it does not have, so there are no RSC requests to fail while offline.
- **The service worker chooses the fallback by path.** A failed navigation to an offline-capable path (`/today`, `/tasks`, `/inbox`, `/search`, `/notes`, `/notes/<id>`, `/projects`, `/settings/app`) gets `/local`. Any other failed navigation gets `/offline` ("You're offline", no data).
- **Who may open the data is decided by the session hint.** The server page writes `{userId, expiresAt}` to `localStorage` on each signed-in load (`SessionHint`). The local app opens the database named for that user (a SHA-256 prefix, `localDbName`) only while `expiresAt` is in the future. After that it shows "Sign in to see your workspace" (feature 04 §0: lock on expiry).
- **Components are shared.** Screens take data as props, so the server pages and the local app render the same components.
- **The fallback never depends on the URL.** After a sign-out the caches are removed, and the shell is put back on the next online page load (feature 03).

## Alternatives

- **Cache the RSC payloads in the worker.** Each page's payload would have to be stored and kept fresh, and those payloads hold account data (the rule from feature 03 forbids it), and they go stale as soon as the server changes. Rejected.
- **Convert every route to a client component.** That gives up server rendering for the whole app, and V1's fast first paint with it. Rejected for V2; it would also be a rewrite the spec does not ask for.
- **A separate static HTML app outside Next** (its own bundle, its own CSS). It would duplicate the design system and the components, and the shared components rule would break. Rejected.
- **Use the App Router for the local app, with the worker rewriting the response.** Next would see a URL it did not render and try to refetch the payload. Rejected for that reason.

## Consequences

- The offline app is one page. Its code is bundled with the rest of the app and is only as large as the screens it renders.
- Pages under `/local` must not use server-only code; the check is in the bundle script (`check:bundle`).
- Links inside the local app do not prefetch. That is fine: all its data is already on the device.
- When the connection returns, a "Back online" message offers to continue on the server-rendered route (feature 04 §5).
- Screens that need the server (account settings, AI, Calendar, Files) show "Needs a connection" in the local app.
- Related: `docs/decisions/0014-service-worker-built-with-esbuild.md`, `agent_docs/pwa-shell-and-install_v2.md`.
