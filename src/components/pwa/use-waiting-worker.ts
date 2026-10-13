"use client";

import { useEffect, useState } from "react";

/**
 * The new service worker, once it has installed and is waiting for the app to be reloaded (V2
 * feature 03 §5). Null on a first install (nothing to update) and when there is no worker.
 */
export function useWaitingWorker(): ServiceWorker | null {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const container = navigator.serviceWorker;
    let cancelled = false;

    const watch = (worker: ServiceWorker) => {
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && container.controller) setWaiting(worker);
        // If the new version fails to activate, the old one keeps running. Hide the banner quietly.
        if (worker.state === "redundant") {
          setWaiting((current) => (current === worker ? null : current));
        }
      });
    };

    container
      .getRegistration()
      .then((registration) => {
        if (cancelled || !registration) return;
        if (registration.waiting && container.controller) setWaiting(registration.waiting);
        registration.addEventListener("updatefound", () => {
          if (registration.installing) watch(registration.installing);
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  return waiting;
}

/** Lets the waiting worker take over, then reloads once. Never reloads on its own. */
export function applyUpdate(worker: ServiceWorker): void {
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  worker.postMessage({ type: "SKIP_WAITING" });
}
