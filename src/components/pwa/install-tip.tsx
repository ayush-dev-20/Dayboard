"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { dismissInstallTip } from "@/lib/pwa/visits";
import { promptInstall } from "@/lib/pwa/install-prompt";
import { useInstall, useInstallTipVisible } from "./use-install";

/**
 * "Install Dayboard for quick access and offline use", once, on the third app open (V2 feature 03
 * §5). Not a growth mechanic: it never repeats, and "Not now" keeps it away for 90 days.
 */
export function InstallTip() {
  const router = useRouter();
  const visible = useInstallTipVisible();
  const view = useInstall();
  if (!visible) return null;

  async function install() {
    if (view === "ios") {
      router.push("/settings/app");
      return;
    }
    const outcome = await promptInstall();
    if (outcome === "dismissed") dismissInstallTip();
  }

  return (
    <section
      aria-label="Install Dayboard"
      className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xs"
    >
      <p className="type-body-md text-foreground">
        Install Dayboard for quick access and offline use.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={dismissInstallTip}>
          Not now
        </Button>
        <Button onClick={install}>{view === "ios" ? "How to install" : "Install"}</Button>
      </div>
    </section>
  );
}
