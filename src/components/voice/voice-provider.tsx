"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { getCapture } from "@/lib/voice/client/api";
import { countRecordings } from "@/lib/voice/client/local-store";
import { flushRecordings } from "@/lib/voice/client/upload";
import type { VoiceCaptureDetail, VoiceCaptureDTO } from "@/lib/voice/types";
import { canRecordHere } from "./use-recorder";
import { useVoiceAvailable } from "./use-voice-available";
import {
  announceVoiceChange,
  VOICE_OPEN_EVENT,
  VoiceContext,
  type VoiceControls,
} from "./voice-context";
import { VoiceDialog, type VoiceStage } from "./voice-dialog";

// Owns the voice dialog and the one capture it is following (V2 feature 13 §4.4, §7). The dialog is only a
// view of this state, so closing it while a capture is still being transcribed does not lose it: the
// provider keeps watching, and says so with a toast when it is ready.

/** How long the app keeps asking, and how often (feature 13 §4.4). */
const POLL_EVERY_MS = 2000;
const POLL_FOR_MS = 90_000;

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { userId, voiceEnabled } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<VoiceStage>({ kind: "record" });
  const [pending, setPending] = useState(0);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // A browser without MediaRecorder hides the microphone everywhere (feature 13 §3).
  const enabled = useVoiceAvailable();

  const refreshPending = useCallback(async () => {
    if (userId) setPending(await countRecordings(userId));
  }, [userId]);

  const follow = useCallback((capture: VoiceCaptureDTO | VoiceCaptureDetail) => {
    announceVoiceChange();
    if (capture.status === "READY" && "transcript" in capture) {
      setStage({ kind: "review", capture });
    } else if (capture.status === "READY") {
      setStage({ kind: "loading", id: capture.id });
    } else if (capture.status === "FAILED") {
      setStage({ kind: "failed", capture });
    } else if (capture.status === "CONSUMED" || capture.status === "DISCARDED") {
      setStage({ kind: "gone" });
    } else {
      setStage({ kind: "waiting", id: capture.id, status: capture.status, since: Date.now() });
    }
  }, []);

  const openVoice = useCallback<VoiceControls["open"]>(
    (options) => {
      // Checked now, not from a render: the shortcut page asks in the same moment the page becomes ready.
      if (!voiceEnabled || !canRecordHere()) return;
      if (options?.captureId) setStage({ kind: "loading", id: options.captureId });
      else setStage({ kind: "record" });
      setOpen(true);
    },
    [voiceEnabled],
  );

  // Anything in the app can ask for the dialog (the command menu, a shortcut, the Inbox list).
  useEffect(() => {
    function onRequest(event: Event) {
      openVoice((event as CustomEvent<{ captureId?: string }>).detail);
    }
    window.addEventListener(VOICE_OPEN_EVENT, onRequest);
    return () => window.removeEventListener(VOICE_OPEN_EVENT, onRequest);
  }, [openVoice]);

  // Loading one capture by id: from the Inbox list, a toast, or a READY one the poll noticed.
  useEffect(() => {
    if (stage.kind !== "loading") return;
    let cancelled = false;
    void getCapture(stage.id).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setStage(
          result.code === "NOT_FOUND"
            ? { kind: "gone" }
            : { kind: "error", message: result.message },
        );
        return;
      }
      follow(result.data.capture);
    });
    return () => {
      cancelled = true;
    };
  }, [stage, follow]);

  // Following a capture that is uploading or being transcribed.
  useEffect(() => {
    if (stage.kind !== "waiting") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const { id, since } = stage;

    async function tick() {
      const result = await getCapture(id);
      if (cancelled) return;
      if (result.ok) {
        const capture = result.data.capture;
        if (capture.status === "READY" || capture.status === "FAILED") {
          follow(capture);
          if (!openRef.current) {
            toast(
              capture.status === "READY"
                ? "Your voice capture is ready to review."
                : "Couldn't transcribe your voice capture.",
              { action: { label: "Open", onClick: () => openVoice({ captureId: id }) } },
            );
          }
          return;
        }
        setStage((s) =>
          s.kind === "waiting" && s.id === id ? { ...s, status: capture.status } : s,
        );
      }
      if (Date.now() - since > POLL_FOR_MS) {
        setStage({ kind: "slow", id });
        if (!openRef.current) {
          toast("Your voice capture is taking longer than usual. It will appear in your Inbox.");
        }
        return;
      }
      timer = setTimeout(() => void tick(), POLL_EVERY_MS);
    }
    timer = setTimeout(() => void tick(), 700);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [stage, follow, openVoice]);

  // Recordings made offline go up when the connection is back, and once at start.
  useEffect(() => {
    if (!voiceEnabled || !userId) return;
    let cancelled = false;
    async function flush() {
      const sent: VoiceCaptureDTO[] = [];
      await flushRecordings(userId, {
        onSent: (capture) => sent.push(capture),
        onDropped: (_recording, message) => toast.error(`A recording couldn't be sent. ${message}`),
      });
      if (cancelled) return;
      await refreshPending();
      if (sent.length === 0) return;
      announceVoiceChange();
      router.refresh();
      const last = sent.at(-1)!;
      toast(
        sent.length === 1
          ? "Your recording is back online and being transcribed."
          : `${sent.length} recordings are back online and being transcribed.`,
      );
      // Follow the newest one quietly, unless the person is busy in the dialog.
      if (!openRef.current) {
        setStage((s) =>
          s.kind === "record" || s.kind === "gone" || s.kind === "error"
            ? { kind: "waiting", id: last.id, status: last.status, since: Date.now() }
            : s,
        );
      }
    }
    void countRecordings(userId).then((n) => {
      if (!cancelled) setPending(n);
    });
    void flush();
    window.addEventListener("online", flush);
    return () => {
      cancelled = true;
      window.removeEventListener("online", flush);
    };
  }, [voiceEnabled, userId, refreshPending, router]);

  const controls = useMemo<VoiceControls>(
    () => ({ enabled, pendingOnDevice: pending, open: openVoice }),
    [enabled, pending, openVoice],
  );

  return (
    <VoiceContext.Provider value={controls}>
      {children}
      {enabled ? (
        <VoiceDialog
          open={open}
          onOpenChange={setOpen}
          stage={stage}
          setStage={setStage}
          onPendingChange={refreshPending}
        />
      ) : null}
    </VoiceContext.Provider>
  );
}
