import type { SubscriptionDTO } from "./subscriptions";
import { urlBase64ToBytes } from "./push-keys";

// The browser's half of push (V2 feature 14 §5): what this device can do, turning notifications on and off here,
// and telling the server. Notifications are asked for only inside `enableOnThisDevice`, which a button calls: never on
// page load, never automatically, never nagged.

const DEVICE_KEY = "dayboard.push-device";
/** Fired on `window` after this device is enabled or disabled, so other parts of the page can look again. */
export const PUSH_CHANGED_EVENT = "dayboard:push-changed";

let fallbackDeviceId: string | null = null;

/** This browser's own id for push: made once, kept in local storage (in memory when storage is blocked). */
export function pushDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    fallbackDeviceId ??= crypto.randomUUID();
    return fallbackDeviceId;
  }
}

export function hasPushApi(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!hasPushApi()) return null;
  // The worker registers after the page loads; do not wait forever for one that never will (development).
  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000));
  return Promise.race([ready, timeout]);
}

export async function readBrowserSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function fetchDevices(): Promise<SubscriptionDTO[]> {
  const response = await fetch("/api/notifications/subscriptions", { cache: "no-store" });
  if (!response.ok) return [];
  return ((await response.json()) as { devices: SubscriptionDTO[] }).devices;
}

export type EnableResult =
  | { ok: true; device: SubscriptionDTO }
  | { ok: false; reason: "denied" | "unavailable" | "failed"; message: string };

/** Asks the browser for permission (this is the only place that does), subscribes, and saves the device. */
export async function enableOnThisDevice(): Promise<EnableResult> {
  if (!hasPushApi()) {
    return {
      ok: false,
      reason: "unavailable",
      message: "This browser can't receive push notifications.",
    };
  }
  try {
    const info = (await (
      await fetch("/api/notifications/vapid-key", { cache: "no-store" })
    ).json()) as {
      available?: boolean;
      publicKey?: string;
      csrf?: string;
    };
    if (!info.available || !info.publicKey || !info.csrf) {
      return {
        ok: false,
        reason: "unavailable",
        message: "Notifications aren't set up on this server.",
      };
    }
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      return {
        ok: false,
        reason: "denied",
        message:
          "Notifications weren't allowed. You can change that in your browser's site settings.",
      };
    }
    const reg = await registration();
    if (!reg)
      return {
        ok: false,
        reason: "failed",
        message: "The app isn't ready for notifications yet. Reload and try again.",
      };
    const deviceId = pushDeviceId();
    const subscribe = () =>
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(info.publicKey!),
      });
    const save = (sub: PushSubscription) => {
      const json = sub.toJSON();
      return fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json", "x-csrf-token": info.csrf! },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, deviceId }),
      });
    };
    let subscription = (await reg.pushManager.getSubscription()) ?? (await subscribe());
    let response = await save(subscription);
    if (response.status === 403) {
      // This browser still holds a subscription made under another account (a sign-out that could not reach the
      // server). It is not ours to use: start a fresh one.
      await subscription.unsubscribe().catch(() => undefined);
      subscription = await subscribe();
      response = await save(subscription);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      await subscription.unsubscribe().catch(() => undefined);
      return {
        ok: false,
        reason: "failed",
        message: body?.message ?? "Couldn't turn notifications on. Try again.",
      };
    }
    // The worker keeps the id, to re-register a subscription the browser replaces.
    reg.active?.postMessage({ type: "PUSH_DEVICE", deviceId });
    window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
    return { ok: true, device: ((await response.json()) as { device: SubscriptionDTO }).device };
  } catch {
    return { ok: false, reason: "failed", message: "Couldn't turn notifications on. Try again." };
  }
}

/** Removes this browser's subscription and tells the server. Best effort: it never throws. */
export async function disableOnThisDevice(devices?: SubscriptionDTO[]): Promise<boolean> {
  try {
    const list = devices ?? (await fetchDevices());
    const mine = list.find((d) => d.deviceId === pushDeviceId());
    if (mine) await fetch(`/api/notifications/subscriptions/${mine.id}`, { method: "DELETE" });
    const subscription = await readBrowserSubscription();
    await subscription?.unsubscribe();
    window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}

/** Sign-out: this device stops receiving this person's notifications. Called before the session ends. */
export async function revokeThisDeviceOnSignOut(): Promise<void> {
  try {
    if (!hasPushApi()) return;
    // Nothing subscribed here: nothing to tell the server, and no request on every sign-out.
    if (!(await readBrowserSubscription())) return;
    await disableOnThisDevice();
  } catch {
    // Sign-out must never wait on, or fail because of, notifications.
  }
}
