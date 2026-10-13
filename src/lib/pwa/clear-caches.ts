import { CACHE_PREFIX } from "@/sw/policy";

/**
 * Removes every Cache Storage entry the service worker made (V2 feature 03 §6). Called on sign-out
 * before the session ends. It is best-effort: a browser that blocks Cache Storage must not block
 * sign-out, so failures are ignored.
 */
export async function clearWorkerCaches(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    for (const key of await caches.keys()) {
      if (key.startsWith(CACHE_PREFIX)) await caches.delete(key);
    }
  } catch {
    // Nothing to clear, or storage is unavailable. Sign-out continues.
  }
}
