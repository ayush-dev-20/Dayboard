"use client";

import { useEffect } from "react";
import {
  PUSH_CHANGED_EVENT,
  pushDeviceId,
  readBrowserSubscription,
} from "@/lib/notifications/client";

const BEAT_MS = 30_000;

/**
 * Tells the server this device has the app open and in front (V2 feature 14 §4): while it does, a due reminder shows
 * inside the app instead of as a push. Beats every 30 seconds, only while the tab is visible and focused, and only on
 * a device that has notifications on. Renders nothing.
 */
export function PushHeartbeat() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    let subscribed = false;
    let stopped = false;

    const active = () => document.visibilityState === "visible" && document.hasFocus();
    const beat = () => {
      if (!subscribed || !active()) return;
      void fetch("/api/notifications/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId: pushDeviceId() }),
        keepalive: true,
      }).catch(() => undefined);
    };
    const look = async () => {
      subscribed = Boolean(await readBrowserSubscription().catch(() => null));
      if (stopped) return;
      if (subscribed && !timer) timer = setInterval(beat, BEAT_MS);
      if (!subscribed && timer) {
        clearInterval(timer);
        timer = undefined;
      }
      beat();
    };

    void look();
    window.addEventListener(PUSH_CHANGED_EVENT, look);
    window.addEventListener("focus", beat);
    document.addEventListener("visibilitychange", beat);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      window.removeEventListener(PUSH_CHANGED_EVENT, look);
      window.removeEventListener("focus", beat);
      document.removeEventListener("visibilitychange", beat);
    };
  }, []);

  return null;
}
