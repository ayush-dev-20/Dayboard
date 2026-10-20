"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadCanvas, saveCanvas } from "@/actions/canvases";
import {
  clearCanvasDraft,
  readCanvasDraft,
  writeCanvasDraft,
  type CanvasDraft,
} from "@/lib/canvas/client-scene";
import type { Scene } from "@/lib/canvas/types";

/** The counts a refine's audit row says (numbers only). */
export type RefineCounts = {
  id: string;
  addedBoxes: number;
  addedConnections: number;
  changedBoxes: number;
  removedBoxes: number;
  removedConnections: number;
};

// Autosave of a drawing (V3 feature 01 §7), like a note's: a change schedules a save 1.5 s after the last one, the save
// carries the version the page started from, a refused save becomes a banner that never blocks drawing, and a failed
// one keeps a draft on the device and tries again. State text only; no toasts for autosave.

export type SaveState = "saved" | "pending" | "saving" | "failed" | "conflict";

const DEBOUNCE_MS = 1500;
const RETRY_MS = [2_000, 5_000, 10_000, 30_000];

export function useCanvasSave({
  canvasId,
  version,
  updatedAt,
  onReplaceScene,
}: {
  canvasId: string;
  version: number;
  updatedAt: string;
  /** Puts a scene on the drawing (Load latest, Recover). The page ignores the change that follows. */
  onReplaceScene: (scene: Scene) => void;
}) {
  const [state, setState] = useState<SaveState>("saved");
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<CanvasDraft | null>(null);
  const versionRef = useRef(version);
  const dirty = useRef<Scene | null>(null);
  const latest = useRef<Scene | null>(null);
  const running = useRef(false);
  const conflict = useRef(false);
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const serverVersion = useRef(version);
  // An AI diagram that was just added: the next save carries its counts, so the audit row is written once.
  const proposal = useRef<{
    id: string;
    sections: number;
    boxes: number;
    connections: number;
  } | null>(null);
  // A refine that was just applied: the same, for its own audit row.
  const refined = useRef<RefineCounts | null>(null);
  // The save schedules itself again (a retry, more edits that arrived while it ran): through a ref, so it can call itself.
  const runRef = useRef<() => Promise<void>>(async () => undefined);

  // A draft from an earlier visit that never saved: offered once, when it is newer than the saved canvas.
  useEffect(() => {
    const found = readCanvasDraft(canvasId);
    // Reads the device, which the server cannot: it runs once the page is on it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (found && found.at > Date.parse(updatedAt)) setDraft(found);
  }, [canvasId, updatedAt]);

  const run = useCallback(async () => {
    if (running.current || conflict.current || !dirty.current) return;
    running.current = true;
    const sending = dirty.current;
    setState("saving");
    try {
      const sendingProposal = proposal.current;
      const sendingRefine = refined.current;
      const result = await saveCanvas({
        id: canvasId,
        version: versionRef.current,
        scene: sending,
        ...(sendingProposal ? { proposal: sendingProposal } : {}),
        ...(sendingRefine ? { refine: sendingRefine } : {}),
      });
      if (!result.ok && (sendingProposal || sendingRefine) && result.error.code === "CONFLICT") {
        // That change was already applied (a second tab, a retry): save the drawing without it.
        proposal.current = null;
        refined.current = null;
        timer.current = setTimeout(() => void runRef.current(), 0);
        return;
      }
      if (!result.ok) {
        // A refusal that retrying cannot fix (too big, something unsupported): say why, keep the draft.
        const permanent =
          result.error.code === "VALIDATION_ERROR" || result.error.code === "NOT_FOUND";
        writeCanvasDraft(canvasId, {
          baseVersion: versionRef.current,
          at: Date.now(),
          scene: sending,
        });
        setMessage(result.error.message);
        setState("failed");
        // Not retried on its own: the next change the person makes tries again.
        if (permanent) return;
        throw new Error("save failed");
      }
      if (result.data.outcome === "conflict") {
        conflict.current = true;
        serverVersion.current = result.data.version;
        setState("conflict");
        return;
      }
      versionRef.current = result.data.version;
      if (sendingProposal && proposal.current === sendingProposal) proposal.current = null;
      if (sendingRefine && refined.current === sendingRefine) refined.current = null;
      failures.current = 0;
      setMessage(null);
      if (dirty.current === sending) {
        dirty.current = null;
        clearCanvasDraft(canvasId);
        setState("saved");
      } else {
        // More edits arrived while this one was on its way.
        setState("pending");
        timer.current = setTimeout(() => void runRef.current(), DEBOUNCE_MS);
      }
    } catch {
      setState("failed");
      writeCanvasDraft(canvasId, {
        baseVersion: versionRef.current,
        at: Date.now(),
        scene: sending,
      });
      const wait = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]!;
      failures.current += 1;
      timer.current = setTimeout(() => void runRef.current(), wait);
    } finally {
      running.current = false;
    }
  }, [canvasId]);
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  /** Called with the drawing as it is now, after every real change. */
  const schedule = useCallback(
    (scene: Scene) => {
      latest.current = scene;
      // While a conflict is open the drawing keeps going, but nothing is sent until the person chooses.
      if (conflict.current) return;
      dirty.current = scene;
      setState((s) => (s === "saving" || s === "failed" ? s : "pending"));
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void run(), DEBOUNCE_MS);
    },
    [run],
  );

  /** An AI diagram was added: schedules a save of the drawing that carries its counts for the audit row. */
  const addDiagram = useCallback(
    (
      scene: Scene,
      counts: { id: string; sections: number; boxes: number; connections: number },
    ) => {
      proposal.current = counts;
      schedule(scene);
    },
    [schedule],
  );

  /** A refine was applied: schedules a save of the drawing that carries its counts for the audit row. */
  const refine = useCallback(
    (scene: Scene, counts: RefineCounts) => {
      refined.current = counts;
      schedule(scene);
    },
    [schedule],
  );

  /** Saves now (leaving the page, closing a panel). */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    await run();
  }, [run]);

  const keepMine = useCallback(() => {
    // Carry on from the latest server version with what is on screen.
    versionRef.current = serverVersion.current;
    conflict.current = false;
    dirty.current = latest.current;
    void run();
  }, [run]);

  const loadLatest = useCallback(async () => {
    const result = await loadCanvas({ id: canvasId });
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    versionRef.current = result.data.version;
    serverVersion.current = result.data.version;
    conflict.current = false;
    dirty.current = null;
    failures.current = 0;
    clearCanvasDraft(canvasId);
    setMessage(null);
    setState("saved");
    onReplaceScene(result.data.scene);
  }, [canvasId, onReplaceScene]);

  const recoverDraft = useCallback(() => {
    if (!draft) return;
    onReplaceScene(draft.scene);
    latest.current = draft.scene;
    dirty.current = draft.scene;
    setDraft(null);
    setState("pending");
    timer.current = setTimeout(() => void run(), 500);
  }, [draft, onReplaceScene, run]);

  const discardDraft = useCallback(() => {
    clearCanvasDraft(canvasId);
    setDraft(null);
  }, [canvasId]);

  // Leaving with something unsaved: keep it on the device, so the next visit can offer it back.
  useEffect(() => {
    const keep = () => {
      if (dirty.current) {
        writeCanvasDraft(canvasId, {
          baseVersion: versionRef.current,
          at: Date.now(),
          scene: dirty.current,
        });
      }
    };
    const onHide = () => {
      if (document.visibilityState === "hidden") keep();
    };
    window.addEventListener("pagehide", keep);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", keep);
      document.removeEventListener("visibilitychange", onHide);
      clearTimeout(timer.current);
    };
  }, [canvasId]);

  return {
    state,
    message,
    draft,
    schedule,
    addDiagram,
    refine,
    flush,
    keepMine,
    loadLatest,
    recoverDraft,
    discardDraft,
  };
}
