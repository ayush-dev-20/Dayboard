"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { updateView } from "@/actions/views";
import { scopeKey } from "@/lib/views/scope";
import type { ViewConfig, ViewDTO } from "@/lib/views/types";

const SAVE_DELAY_MS = 500;

/** `seen` is the version of the view prop this copy was taken from (saving moves the server's version on, not this). */
type Local = { id: string; seen: number; config: ViewConfig; dirty: boolean };

/**
 * The view's settings while they are being edited (V2 feature 06 §5). A change shows at once and is
 * saved a moment later (several changes in a row are one save), with no save step for the person.
 * When a change alters which items the page must read (finished or archived ones), the page is
 * refreshed after the save so the server reads the new set; otherwise nothing is reloaded.
 */
export function useViewConfig(view: ViewDTO) {
  const router = useRouter();
  const [local, setLocal] = useState<Local>({
    id: view.id,
    seen: view.version,
    config: view.config,
    dirty: false,
  });
  const [savedScope, setSavedScope] = useState(() =>
    scopeKey(view.collection, view.type, view.config),
  );

  // Another view, or a newer saved version while nothing here is unsaved, replaces the local copy.
  if (local.id !== view.id || (!local.dirty && local.seen !== view.version)) {
    setLocal({ id: view.id, seen: view.version, config: view.config, dirty: false });
    setSavedScope(scopeKey(view.collection, view.type, view.config));
  }

  const latest = useRef(local);
  useEffect(() => {
    latest.current = local;
  });

  useEffect(() => {
    if (!local.dirty) return;
    const { id, config } = local;
    const timer = setTimeout(async () => {
      const result = await updateView({ id, config });
      if (!result.ok) {
        toast.error("Couldn't save the view settings. They are kept while this page is open.");
        return;
      }
      setLocal((now) => (now.id === id ? { ...now, dirty: now.config !== config } : now));
      const next = scopeKey(view.collection, view.type, config);
      if (next !== savedScope) {
        setSavedScope(next);
        router.refresh();
      }
    }, SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [local, view.collection, view.type, savedScope, router]);

  // Leaving the page with a change that has not been saved yet saves it now.
  useEffect(
    () => () => {
      const pending = latest.current;
      if (pending.dirty) void updateView({ id: pending.id, config: pending.config });
    },
    [],
  );

  function update(change: (config: ViewConfig) => ViewConfig) {
    setLocal((now) => ({ ...now, config: change(now.config), dirty: true }));
  }

  return { config: local.config, update, dirty: local.dirty };
}
