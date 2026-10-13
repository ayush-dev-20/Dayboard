"use client";

import { useEffect } from "react";
import { listenForInstallPrompt } from "@/lib/pwa/install-prompt";

/**
 * Registers the offline worker (V2 feature 03 §3). Production builds only, after the page has
 * loaded, so it never slows the first paint. In `next dev` it stays off, because a development
 * worker would keep serving stale modules. Browsers without service workers skip it silently.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    listenForInstallPrompt();
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_SW !== "1") return;
    if (!("serviceWorker" in navigator)) return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Registration can fail (for example, when storage is blocked). The app works as before.
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);

  return null;
}
