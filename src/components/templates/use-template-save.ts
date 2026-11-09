"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveTemplate } from "@/actions/templates";
import type { TiptapDoc } from "@/lib/editor/types";

// Autosave of a template (V3 feature 03 §6), in the shape of a note's: a change schedules a save 0.8 s after the last one,
// the save carries the version the page started from, a refused save becomes a banner that never blocks typing, and a
// failed one is tried again with growing waits. State text only; no toasts for autosave.

export type TemplateSaveState = "saved" | "pending" | "saving" | "failed" | "conflict";

export type TemplatePatch = { contentJson?: TiptapDoc; name?: string; titlePattern?: string };

const DEBOUNCE_MS = 800;
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

export function useTemplateSave({ id, version }: { id: string; version: number }) {
  const [state, setState] = useState<TemplateSaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const versionRef = useRef(version);
  const serverVersion = useRef(version);
  const pending = useRef<TemplatePatch>({});
  const running = useRef(false);
  const conflict = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const runRef = useRef<() => Promise<void>>(async () => undefined);

  const hasPending = () => Object.keys(pending.current).length > 0;

  const run = useCallback(async () => {
    if (running.current || conflict.current || !hasPending()) return;
    running.current = true;
    const sending = pending.current;
    pending.current = {};
    setState("saving");
    // Anything typed while this one is on its way is kept in `pending`; a failed one goes back underneath it.
    const putBack = () => {
      pending.current = { ...sending, ...pending.current };
    };
    try {
      const result = await saveTemplate({ id, version: versionRef.current, ...sending });
      if (!result.ok) {
        putBack();
        setState("failed");
        // A refusal that retrying cannot fix (a forbidden block, a name that is too long): say why and wait for the
        // next change instead of asking again.
        if (result.error.code === "VALIDATION_ERROR" || result.error.code === "NOT_FOUND") {
          setMessage(result.error.message);
          return;
        }
        throw new Error("save failed");
      }
      if (result.data.outcome === "conflict") {
        putBack();
        conflict.current = true;
        serverVersion.current = result.data.version;
        setState("conflict");
        return;
      }
      versionRef.current = result.data.version;
      failures.current = 0;
      setMessage(null);
      if (hasPending()) {
        setState("pending");
        timer.current = setTimeout(() => void runRef.current(), DEBOUNCE_MS);
      } else {
        setState("saved");
      }
    } catch {
      putBack();
      setState("failed");
      const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]!;
      failures.current += 1;
      timer.current = setTimeout(() => void runRef.current(), wait);
    } finally {
      running.current = false;
    }
  }, [id]);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  /** Called after every change with what changed. Later changes to the same field win. */
  const schedule = useCallback(
    (patch: TemplatePatch) => {
      pending.current = { ...pending.current, ...patch };
      if (conflict.current) return;
      setMessage(null);
      setState((s) => (s === "saving" ? s : "pending"));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
    },
    [run],
  );

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await run();
  }, [run]);

  /** After a conflict: save what is on screen on top of the server's copy. */
  const keepMine = useCallback(() => {
    versionRef.current = serverVersion.current;
    conflict.current = false;
    void run();
  }, [run]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { state, message, schedule, flush, keepMine };
}
