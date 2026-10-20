import type { InstallView } from "@/lib/pwa/install";

// What "This device" says on Settings → Notifications (V2 feature 14 §5). Pure, so each message is tested.

export type DevicePushState =
  /** Working out what this browser can do. */
  | "checking"
  /** The server has no push keys: reminders still show inside the app. */
  | "server-off"
  /** This browser cannot do push at all. */
  | "unsupported"
  /** iOS Safari: push works only for the app added to the Home Screen (iOS 16.4 and later). */
  | "needs-install"
  /** The person said no in the browser. Only the browser's own settings can change that. */
  | "blocked"
  /** Not enabled on this device. */
  | "off"
  /** Enabled on this device. */
  | "on";

export function devicePushState(input: {
  serverAvailable: boolean;
  /** The browser has a service worker, push and notifications. */
  hasPushApi: boolean;
  install: InstallView;
  permission: NotificationPermission | "unsupported";
  /** This browser has a push subscription and the server knows it. */
  subscribed: boolean;
}): DevicePushState {
  if (!input.serverAvailable) return "server-off";
  if (!input.hasPushApi) return input.install === "ios" ? "needs-install" : "unsupported";
  if (input.permission === "denied") return "blocked";
  return input.subscribed ? "on" : "off";
}

/** The one line under the state: what it means, in plain words. */
export function deviceStateMessage(state: DevicePushState): string {
  switch (state) {
    case "checking":
      return "Checking this device…";
    case "server-off":
      return "Push notifications aren't set up on this server. Reminders still show inside Dayboard.";
    case "unsupported":
      return "This browser can't receive push notifications. Reminders still show inside Dayboard while it is open.";
    case "needs-install":
      return "On iPhone and iPad, notifications work only for the installed app (iOS 16.4 or later). Add Dayboard to your Home Screen, then open it from there.";
    case "blocked":
      return "Notifications are blocked for this site in your browser. Allow them in the browser's site settings, then come back here.";
    case "off":
      return "Not enabled on this device. Reminders will show inside Dayboard while it is open.";
    case "on":
      return "Enabled on this device.";
  }
}
