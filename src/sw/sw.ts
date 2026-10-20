// Dayboard's service worker (V2 feature 03). Bundled into public/sw.js by scripts/build-sw.mjs.
// The rules live in ./policy.ts; this file only connects them to the browser's events.
//
// It never calls skipWaiting by itself. A new version waits until the page asks for it (the
// update banner), so an edit in progress is never interrupted.

import {
  CACHE_PREFIX,
  OFFLINE_PATH,
  cacheNames,
  classify,
  isStorable,
  shellAssetPaths,
} from "./policy";
import { decideClick, notificationFor, parsePush } from "./push";
import { urlBase64ToBytes } from "../lib/notifications/push-keys";

// Replaced at build time by scripts/build-sw.mjs. Each build gets its own id, so each deploy
// produces a new worker and new cache names.
declare const __BUILD_ID__: string;

// The worker's global scope is not in the "dom" library the app is type-checked with, so the
// few members used here are declared directly.
type Listener<E> = (event: E) => void;
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}
interface FetchEvent extends Event {
  request: Request;
  waitUntil(promise: Promise<unknown>): void;
  respondWith(response: Promise<Response> | Response): void;
}
interface WorkerScope {
  skipWaiting(): Promise<void>;
  clients: {
    claim(): Promise<void>;
    matchAll(options: {
      type: "window";
      includeUncontrolled: boolean;
    }): Promise<WindowClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: "install" | "activate", listener: Listener<ExtendableEvent>): void;
  addEventListener(type: "fetch", listener: Listener<FetchEvent>): void;
  addEventListener(type: "message", listener: Listener<ExtendableMessageEvent>): void;
  addEventListener(type: "push", listener: Listener<PushEvent>): void;
  addEventListener(type: "notificationclick", listener: Listener<NotificationClickEvent>): void;
  addEventListener(
    type: "pushsubscriptionchange",
    listener: Listener<SubscriptionChangeEvent>,
  ): void;
  registration: {
    showNotification(title: string, options?: unknown): Promise<void>;
    pushManager: { subscribe(options: unknown): Promise<PushSubscriptionLike> };
  };
}
interface ExtendableMessageEvent extends MessageEvent {
  waitUntil(promise: Promise<unknown>): void;
}
interface PushEvent extends ExtendableEvent {
  data: { text(): string } | null;
}
interface NotificationClickEvent extends ExtendableEvent {
  action: string;
  notification: { close(): void; data?: { url?: unknown; token?: unknown } | null };
}
interface PushSubscriptionLike {
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
}
interface SubscriptionChangeEvent extends ExtendableEvent {
  oldSubscription?: { options?: { applicationServerKey?: ArrayBuffer | null } } | null;
}
interface WindowClientLike {
  url: string;
  focus(): Promise<unknown>;
  navigate?(url: string): Promise<unknown>;
}

const worker = self as unknown as WorkerScope;
const names = cacheNames(__BUILD_ID__);

/** Files the shell needs that are not linked from its HTML. */
const EXTRA_SHELL_FILES = ["/icon.svg"];

/** Puts the shell back if it is missing (after sign-out cleared the caches). */
async function ensureShell(): Promise<void> {
  const cache = await caches.open(names.shell);
  if (!(await cache.match(OFFLINE_PATH))) await precacheShell();
}

async function precacheShell(): Promise<void> {
  const cache = await caches.open(names.shell);

  // The shell page is ours and holds no account data, so it is stored whatever its headers say.
  const response = await fetch(OFFLINE_PATH, { cache: "reload" });
  if (!response.ok) throw new Error(`offline shell returned ${response.status}`);
  const html = await response.text();
  await cache.put(
    OFFLINE_PATH,
    new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }),
  );

  for (const path of [...shellAssetPaths(html), ...EXTRA_SHELL_FILES]) {
    const asset = await fetch(path, { cache: "reload" });
    if (!asset.ok) throw new Error(`shell asset ${path} returned ${asset.status}`);
    await cache.put(path, asset);
  }
}

async function removeOldCaches(): Promise<void> {
  const keep = new Set<string>(Object.values(names));
  for (const key of await caches.keys()) {
    if (key.startsWith(CACHE_PREFIX) && !keep.has(key)) await caches.delete(key);
  }
}

/**
 * Page loads: the network first, then the offline shell when the request fails. Pages are never
 * stored. There is no timeout: a slow but working server (a cold database, say) must not show the
 * offline page to someone who is online (see docs/decisions/0014). After a sign-out removes the
 * caches, the shell is put back on the next online page load (it holds no account data).
 */
async function navigate(event: FetchEvent): Promise<Response> {
  try {
    const response = await fetch(event.request);
    event.waitUntil(ensureShell());
    return response;
  } catch {
    const cache = await caches.open(names.shell);
    const shell = await cache.match(OFFLINE_PATH);
    return (
      shell ??
      new Response("You're offline.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    );
  }
}

/** Build files and public assets: serve the cached copy at once, refresh it in the background. */
async function staticAsset(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(names.static);
  const cached = await cache.match(event.request);
  const refresh = fetch(event.request).then(async (response) => {
    if (isStorable(response)) await cache.put(event.request, response.clone());
    return response;
  });

  if (cached) {
    event.waitUntil(refresh.catch(() => undefined));
    return cached;
  }
  return refresh;
}

worker.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await removeOldCaches();
      // Controls pages that are already open. This only runs after the person has chosen to
      // update (or on a first install), so no page changes under them mid-edit.
      await worker.clients.claim();
    })(),
  );
});

worker.addEventListener("fetch", (event) => {
  const route = classify({
    url: event.request.url,
    origin: self.location.origin,
    method: event.request.method,
    mode: event.request.mode,
  });
  if (route.kind === "skip" || route.kind === "network") return;
  if (route.kind === "navigate") {
    event.respondWith(navigate(event));
    return;
  }
  event.respondWith(staticAsset(event));
});

worker.addEventListener("message", (event) => {
  const data = event.data as { type?: unknown; deviceId?: unknown } | null;
  if (data?.type === "SKIP_WAITING") void worker.skipWaiting();
  // The page tells the worker which device it is, so a subscription the browser replaces can be re-registered
  // later without the page open (the worker cannot read the page's storage).
  if (data?.type === "PUSH_DEVICE" && typeof data.deviceId === "string") {
    event.waitUntil(rememberDevice(data.deviceId));
  }
});

// Push notifications (V2 feature 14 §4). What to show and what a click does is decided in `push.ts`; this only
// applies it.

worker.addEventListener("push", (event) => {
  let raw: string | null = null;
  try {
    raw = event.data ? event.data.text() : null;
  } catch {
    raw = null;
  }
  // An unreadable payload still shows a generic notification: a push that shows nothing can cost the subscription.
  const plan = notificationFor(parsePush(raw));
  event.waitUntil(worker.registration.showNotification(plan.title, plan.options));
});

/** Focuses a window of the app on the link, or opens one. Sign-in is handled by the page the link lands on. */
async function openPath(path: string): Promise<void> {
  const target = new URL(path, self.location.origin).href;
  const windows = await worker.clients.matchAll({ type: "window", includeUncontrolled: true });
  const existing = windows.find((w) => w.url.startsWith(self.location.origin));
  if (existing) {
    await existing.focus();
    if (existing.navigate) await existing.navigate(target);
    return;
  }
  await worker.clients.openWindow(target);
}

worker.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const decision = decideClick(event.action, event.notification.data);
  event.waitUntil(
    (async () => {
      if (decision.kind === "snooze") {
        try {
          const response = await fetch("/api/notifications/snooze", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: decision.token }),
          });
          if (response.ok) return;
        } catch {
          // Offline, or signed out: fall through and open the task so the person can deal with it there.
        }
      }
      await openPath(decision.url);
    })(),
  );
});

async function rememberDevice(deviceId: string): Promise<void> {
  const cache = await caches.open(names.pushDevice);
  await cache.put("/__push-device", new Response(deviceId));
}

worker.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(names.pushDevice);
        const deviceId = await (await cache.match("/__push-device"))?.text();
        if (!deviceId) return;
        const info = (await (
          await fetch("/api/notifications/vapid-key", { credentials: "same-origin" })
        ).json()) as { publicKey?: string; csrf?: string };
        const key =
          event.oldSubscription?.options?.applicationServerKey ??
          (info.publicKey ? urlBase64ToBytes(info.publicKey) : null);
        if (!key || !info.csrf) return;
        const subscription = await worker.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        const json = subscription.toJSON();
        // The server replaces this device's old endpoint with the new one.
        await fetch("/api/notifications/subscribe", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json", "x-csrf-token": info.csrf },
          body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceId }),
        });
      } catch {
        // Not signed in, offline, or the browser refused: the device shows as not enabled in Settings.
      }
    })(),
  );
});
