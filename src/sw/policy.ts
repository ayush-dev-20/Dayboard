// The service worker's caching rules, kept free of browser APIs so they can be unit-tested.
// See V2 feature 03 §3 and docs/decisions/0014. The worker in sw.ts only applies these.

/** The offline shell: a static page with no account data. Precached at install. */
export const OFFLINE_PATH = "/offline";

/** Every cache the worker creates starts with this, so sign-out can find and remove them all. */
export const CACHE_PREFIX = "dayboard-";

export type Route =
  /** Not ours: another origin, a write, or the API. The browser handles it as if no worker existed. */
  | { kind: "skip" }
  /** A page load. Network first; the offline shell if the network does not answer in time. */
  | { kind: "navigate" }
  /** Hashed build files and public assets. Served from cache, refreshed in the background. */
  | { kind: "static" }
  /** Everything else (data, server actions, sign-in): network only, never stored. */
  | { kind: "network" };

const STATIC_PREFIXES = ["/_next/static/", "/brand/", "/emojibase/", "/excalidraw/", "/icons/"];
const STATIC_EXACT = ["/icon.svg", "/apple-icon", "/manifest.webmanifest"];

export function classify(input: {
  url: string;
  origin: string;
  method: string;
  mode: string;
}): Route {
  const url = new URL(input.url);
  if (url.origin !== input.origin) return { kind: "skip" };
  if (input.method !== "GET") return { kind: "skip" };
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return { kind: "network" };
  if (input.mode === "navigate") return { kind: "navigate" };
  if (
    STATIC_EXACT.includes(url.pathname) ||
    STATIC_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))
  ) {
    return { kind: "static" };
  }
  return { kind: "network" };
}

/**
 * A response may be stored only if it is a plain success with no cookie and no
 * `no-store` / `private` marking. A personal response must never end up in a shared cache.
 */
export function isStorable(response: {
  ok: boolean;
  headers: { get(name: string): string | null };
}): boolean {
  if (!response.ok) return false;
  if (response.headers.get("set-cookie") !== null) return false;
  const cacheControl = (response.headers.get("cache-control") ?? "").toLowerCase();
  return !cacheControl.includes("no-store") && !cacheControl.includes("private");
}

/**
 * The files the offline shell needs to draw itself: the scripts, styles and fonts it links to.
 * They are read from the shell's own HTML at install time, so the list follows each build.
 */
export function shellAssetPaths(html: string): string[] {
  const paths = new Set<string>();
  // Query strings stay: Next adds a deployment id (`?dpl=`) that the browser also requests.
  for (const match of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"#]+)"/g)) {
    const path = match[1];
    if (path) paths.add(path);
  }
  return [...paths];
}

/** Cache names for one build. Anything with the prefix that is not in this list is removed. */
export function cacheNames(buildId: string) {
  return {
    shell: `${CACHE_PREFIX}shell-${buildId}`,
    static: `${CACHE_PREFIX}static-${buildId}`,
    // The id of this device for push (feature 14). Not per build, so an update keeps it; sign-out still removes it.
    pushDevice: `${CACHE_PREFIX}push-device`,
  };
}
