"use client";

import { useSyncExternalStore } from "react";
import { getInstallPrompt, subscribeInstallPrompt } from "@/lib/pwa/install-prompt";
import { installView, showInstallTip, type InstallView } from "@/lib/pwa/install";
import { readDismissedAt, readVisitCount, subscribeVisits } from "@/lib/pwa/visits";

function subscribe(listener: () => void): () => void {
  const unsubscribePrompt = subscribeInstallPrompt(listener);
  const unsubscribeVisits = subscribeVisits(listener);
  return () => {
    unsubscribePrompt();
    unsubscribeVisits();
  };
}

function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function currentView(): InstallView {
  return installView({
    standalone: isStandalone(),
    hasPrompt: getInstallPrompt() !== null,
    userAgent: navigator.userAgent,
    touchPoints: navigator.maxTouchPoints,
  });
}

/** What this browser can do about installing Dayboard (V2 feature 03 §5). */
export function useInstall(): InstallView {
  // Server-rendered as "unsupported": the install UI appears only once the browser is known.
  return useSyncExternalStore(subscribe, currentView, () => "unsupported");
}

/** Whether the install tip should be shown right now. */
export function useInstallTipVisible(): boolean {
  return useSyncExternalStore(
    subscribe,
    () =>
      showInstallTip({
        view: currentView(),
        visits: readVisitCount(),
        dismissedAt: readDismissedAt(),
        now: Date.now(),
      }),
    () => false,
  );
}
