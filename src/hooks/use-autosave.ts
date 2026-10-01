"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "failed";

type Options<T> = {
  /** Persists a value. Resolve true on success, false (or throw) on failure. */
  save: (value: T) => Promise<boolean>;
  delayMs?: number;
};

const RETRY_DELAYS_MS = [2000, 4000, 8000, 16000, 30000];
const SAVED_VISIBLE_MS = 2000;

/**
 * Debounced autosave. `schedule(value)` on every change; the latest value is saved after a quiet
 * moment. Failures keep the latest value in memory and retry with backoff (and when the browser
 * comes back online), so a network blip never loses confirmed text. Leaving the page while a save
 * is pending or failed asks for confirmation.
 */
export function useAutosave<T>({ save, delayMs = 800 }: Options<T>) {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const latest = useRef<{ value: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempts = useRef(0);
  const inFlight = useRef(false);
  const saveRef = useRef(save);
  const dirty = useRef(false);
  // `run` calls itself again (more typing arrived, or a retry). Going through a ref keeps the
  // callback from referring to itself while it is being declared.
  const runRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    saveRef.current = save;
  });

  const run = useCallback(async () => {
    if (inFlight.current || !latest.current) return;
    inFlight.current = true;
    const sending = latest.current;
    setStatus("saving");

    let succeeded = false;
    try {
      succeeded = await saveRef.current(sending.value);
    } catch {
      succeeded = false;
    }
    inFlight.current = false;

    if (succeeded) {
      attempts.current = 0;
      if (latest.current === sending) {
        latest.current = null;
        dirty.current = false;
        setStatus("saved");
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setStatus("idle"), SAVED_VISIBLE_MS);
      } else {
        void runRef.current(); // more typing arrived while saving
      }
      return;
    }

    setStatus("failed");
    const delay = RETRY_DELAYS_MS[Math.min(attempts.current, RETRY_DELAYS_MS.length - 1)] as number;
    attempts.current += 1;
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => void runRef.current(), delay);
  }, []);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  const schedule = useCallback(
    (value: T) => {
      latest.current = { value };
      dirty.current = true;
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), delayMs);
    },
    [delayMs, run],
  );

  /** Save right now (for example when the editor loses focus or the sheet closes). */
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    if (latest.current) void run();
  }, [run]);

  useEffect(() => {
    const onOnline = () => {
      if (latest.current && !inFlight.current) void run();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("beforeunload", onBeforeUnload);
      // Unmounting with unsaved text: send it now rather than dropping it.
      if (timer.current) clearTimeout(timer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (savedTimer.current) clearTimeout(savedTimer.current);
      if (latest.current && !inFlight.current) void saveRef.current(latest.current.value);
    };
  }, [run]);

  return { status, schedule, flush };
}
