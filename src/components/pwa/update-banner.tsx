"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { hasUnsavedChanges, subscribeUnsaved } from "@/lib/pwa/unsaved";
import { updateView } from "@/lib/pwa/update";
import { applyUpdate, useWaitingWorker } from "./use-waiting-worker";

/**
 * "A new version is ready" (V2 feature 03 §5). Quiet, never automatic: it waits for the person to
 * choose Reload, and offers Reload only when nothing is unsaved.
 */
export function UpdateBanner() {
  const worker = useWaitingWorker();
  const unsaved = useSyncExternalStore(subscribeUnsaved, hasUnsavedChanges, () => false);
  const view = updateView({ waiting: worker !== null, unsaved });
  if (view === "hidden") return null;

  return (
    <div
      role="status"
      className="fixed inset-x-4 top-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-float md:inset-x-auto md:right-4 md:mx-0"
    >
      <p className="type-body-md text-foreground">A new version is ready.</p>
      {view === "ready" && worker ? (
        <Button onClick={() => applyUpdate(worker)}>Reload</Button>
      ) : (
        <p className="type-body-sm text-muted-foreground">Reload when you finish</p>
      )}
    </div>
  );
}
