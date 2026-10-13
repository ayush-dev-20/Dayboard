// Visits to the app, kept on this device for the install tip (V2 feature 03 §5). Counts app opens,
// not page views: a tab counts once per session. Nothing here is sent anywhere.

export const VISIT_COUNT_KEY = "pwa:visitCount";
export const DISMISSED_KEY = "pwa:installDismissedAt";
const COUNTED_KEY = "pwa:visitCounted";
const CHANGE_EVENT = "pwa:storage";

function safeGet(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // Storage can be blocked (private modes). The tip simply does not appear.
  }
}

function local(): Storage | undefined {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function notify(): void {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function readVisitCount(): number {
  const count = Number(safeGet(local(), VISIT_COUNT_KEY));
  return Number.isFinite(count) && count > 0 ? count : 0;
}

export function readDismissedAt(): number | null {
  const at = Number(safeGet(local(), DISMISSED_KEY));
  return Number.isFinite(at) && at > 0 ? at : null;
}

/** Counts this app open once per browser session. */
export function countVisit(): void {
  if (typeof window === "undefined") return;
  const session = window.sessionStorage;
  if (safeGet(session, COUNTED_KEY) === "1") return;
  safeSet(session, COUNTED_KEY, "1");
  safeSet(local(), VISIT_COUNT_KEY, String(readVisitCount() + 1));
  notify();
}

export function dismissInstallTip(): void {
  safeSet(local(), DISMISSED_KEY, String(Date.now()));
  notify();
}

/** Re-reads when another tab changes these values, or this tab writes them. */
export function subscribeVisits(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
