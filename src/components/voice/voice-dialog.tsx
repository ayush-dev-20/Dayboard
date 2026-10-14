"use client";

import { Mic, Pause, Play, Square, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useCommandMenu } from "@/components/command/command-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { uuidv7 } from "@/lib/ids";
import { cn } from "@/lib/utils";
import { discardCapture, retryCapture } from "@/lib/voice/client/api";
import {
  deleteRecording,
  saveRecording,
  type LocalRecording,
} from "@/lib/voice/client/local-store";
import { sendRecording } from "@/lib/voice/client/upload";
import {
  VOICE_COUNTDOWN_MS,
  VOICE_MAX_MS,
  type VoiceCaptureDetail,
  type VoiceCaptureDTO,
  type VoiceCaptureStatus,
} from "@/lib/voice/types";
import { LevelMeter } from "./level-meter";
import { ReviewPanel } from "./review-panel";
import { useRecorder } from "./use-recorder";
import { announceVoiceChange } from "./voice-context";

export type VoiceStage =
  | { kind: "record" }
  | { kind: "sending" }
  /** The recording is safe on this device and will go up when there is a connection. */
  | { kind: "offline" }
  /** It could not be stored or sent; the recording is still in this tab's memory. */
  | { kind: "unsent"; message: string }
  | { kind: "loading"; id: string }
  | { kind: "waiting"; id: string; status: VoiceCaptureStatus; since: number }
  | { kind: "slow"; id: string }
  | { kind: "review"; capture: VoiceCaptureDetail }
  | { kind: "failed"; capture: VoiceCaptureDTO }
  | { kind: "gone" }
  | { kind: "error"; message: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stage: VoiceStage;
  setStage: (stage: VoiceStage) => void;
  onPendingChange: () => Promise<void> | void;
};

const clock = (ms: number) => {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const FAILURE_TEXT: Record<string, string> = {
  RATE_LIMITED:
    "You've reached the AI limit for now. Your recording is kept for a day, so you can try again later.",
  NO_SPEECH: "We couldn't hear anything in that recording. You can try again or discard it.",
  AI_DISABLED: "AI features are turned off, so this can't be transcribed.",
  AUDIO_MISSING: "The recording is no longer available. Please record it again.",
  EXPIRED: "This recording was never fully uploaded and has expired. Please record it again.",
};
const failureText = (code: string | null) =>
  (code && FAILURE_TEXT[code]) ||
  "Couldn't transcribe that. Your recording is kept for a day, so you can try again.";

/**
 * The one dialog for voice capture (V2 feature 13 §3, §6, §7): record, follow the upload and the
 * transcription, review, and handle failure. Full-screen on phones. The stage lives in the provider,
 * so closing this never loses a capture that is still being processed.
 */
export function VoiceDialog({ open, onOpenChange, stage, setStage, onPendingChange }: Props) {
  const { userId } = useWorkspace();
  const command = useCommandMenu();
  const { recorder, state } = useRecorder();
  const [confirmingClose, setConfirmingClose] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const unsent = useRef<LocalRecording | null>(null);
  const started = useRef(false);

  // Closing the dialog lets go of the microphone and throws away a recording that was not finished.
  useEffect(() => {
    if (open) return;
    recorder.cancel();
    started.current = false;
  }, [open, recorder]);

  // Every way out of the dialog goes through here, so the next time it opens it starts clean.
  const close = useCallback(() => {
    setConfirmingClose(false);
    setReviewDirty(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const toWaiting = useCallback(
    (capture: VoiceCaptureDTO) => {
      announceVoiceChange();
      // Ready or failed already (the server did the work before answering): fetch the detail.
      if (capture.status === "READY" || capture.status === "FAILED") {
        setStage({ kind: "loading", id: capture.id });
      } else {
        setStage({ kind: "waiting", id: capture.id, status: capture.status, since: Date.now() });
      }
    },
    [setStage],
  );

  const submit = useCallback(
    async (recording: LocalRecording) => {
      setStage({ kind: "sending" });
      let stored = true;
      try {
        await saveRecording(userId, recording);
      } catch {
        stored = false;
      }
      await onPendingChange();
      const hold = (message: string) => {
        unsent.current = recording;
        setStage({ kind: "unsent", message });
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        if (stored) setStage({ kind: "offline" });
        else hold("This browser couldn't keep the recording while you're offline.");
        return;
      }
      const outcome = await sendRecording(recording);
      if (outcome.ok) {
        unsent.current = null;
        await deleteRecording(userId, recording.id);
        await onPendingChange();
        toWaiting(outcome.capture);
      } else if (outcome.retry) {
        if (stored) setStage({ kind: "offline" });
        else hold(outcome.message);
      } else {
        await deleteRecording(userId, recording.id);
        await onPendingChange();
        setStage({ kind: "error", message: outcome.message });
      }
    },
    [userId, onPendingChange, setStage, toWaiting],
  );

  // When recording ends (Done, the time limit, the size limit, or an interruption), save and send it.
  useEffect(() => {
    if (state.phase !== "done" || !state.result || stage.kind !== "record") return;
    const { blob, mimeType, durationMs, endedBy } = state.result;
    recorder.reset();
    if (endedBy === "time") toast("You reached the five-minute limit. Your recording was saved.");
    if (endedBy === "size") toast("You reached the size limit. Your recording was saved.");
    if (endedBy === "interrupted") toast("The microphone stopped. What you recorded was kept.");
    void submit({
      id: uuidv7(),
      blob,
      mimeType,
      sizeBytes: blob.size,
      durationMs,
      createdAt: Date.now(),
      attempts: 0,
      lastError: null,
    });
  }, [state.phase, state.result, stage.kind, recorder, submit]);

  function requestClose() {
    if (stage.kind === "record" && (state.phase === "recording" || state.phase === "paused")) {
      setConfirmingClose(true);
      return;
    }
    if (stage.kind === "review" && reviewDirty) {
      setConfirmingClose(true);
      return;
    }
    // A capture that is still being processed keeps going; a review that was not edited is kept for later.
    if (stage.kind === "review") toast("Saved under Voice captures in your Inbox.");
    close();
  }

  const typeInstead = () => {
    close();
    command.open("capture");
  };

  const wide = stage.kind === "review";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent
        // Full-screen on phones (feature 13 §6), a dialog from 640px up.
        className={cn(
          "max-md:top-0 max-md:left-0 max-md:h-dvh max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:overflow-y-auto max-md:rounded-none",
          "md:max-h-[calc(100dvh-48px)] md:overflow-y-auto",
          wide && "md:max-w-[680px]",
        )}
        onInteractOutside={(event) => {
          // A stray click must not throw a recording or an edited review away.
          if (state.phase === "recording" || state.phase === "paused" || reviewDirty) {
            event.preventDefault();
          }
        }}
      >
        <DialogTitle>
          {stage.kind === "review" ? "Review your voice capture" : "Voice capture"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Record a thought, check what was heard, then choose what to create.
        </DialogDescription>

        {stage.kind === "record" ? (
          <RecorderView
            recorder={recorder}
            state={state}
            confirmingClose={confirmingClose}
            onKeepRecording={() => setConfirmingClose(false)}
            onDiscardRecording={() => {
              recorder.cancel();
              setConfirmingClose(false);
              close();
            }}
            onTypeInstead={typeInstead}
            onStart={() => {
              started.current = true;
              void recorder.start();
            }}
          />
        ) : null}

        {stage.kind === "sending" ? (
          <Progress label="Uploading" hint="Keep this open for a moment." />
        ) : null}

        {stage.kind === "waiting" || stage.kind === "loading" ? (
          <>
            <Progress
              label={
                stage.kind === "loading"
                  ? "Opening"
                  : stage.status === "UPLOADING"
                    ? "Uploading"
                    : "Transcribing"
              }
              hint="You can close this. It will be waiting under Voice captures in your Inbox."
            />
            <Footer>
              <Button variant="secondary" onClick={() => close()}>
                Close
              </Button>
            </Footer>
          </>
        ) : null}

        {stage.kind === "slow" ? (
          <>
            <p className="mt-4 type-body-md">
              This is taking longer than usual. It will appear under Voice captures in your Inbox
              when it&apos;s ready.
            </p>
            <Footer>
              <Button onClick={() => close()}>Close</Button>
            </Footer>
          </>
        ) : null}

        {stage.kind === "offline" ? (
          <>
            <Alert tone="info" className="mt-4">
              Saved on this device. We&apos;ll transcribe it when you&apos;re back online.
            </Alert>
            <Footer>
              <Button onClick={() => close()}>Done</Button>
            </Footer>
          </>
        ) : null}

        {stage.kind === "unsent" ? (
          <>
            <Alert className="mt-4">{stage.message} Your recording is still in this tab.</Alert>
            <Footer>
              <Button
                variant="secondary"
                onClick={() => {
                  unsent.current = null;
                  close();
                }}
              >
                Discard
              </Button>
              <Button
                onClick={() => {
                  if (unsent.current) void submit(unsent.current);
                }}
              >
                Try again
              </Button>
            </Footer>
          </>
        ) : null}

        {stage.kind === "error" ? (
          <>
            <Alert className="mt-4">{stage.message}</Alert>
            <Footer>
              <Button
                variant="secondary"
                onClick={() => {
                  setStage({ kind: "record" });
                }}
              >
                Record again
              </Button>
              <Button onClick={() => close()}>Close</Button>
            </Footer>
          </>
        ) : null}

        {stage.kind === "gone" ? (
          <>
            <p className="mt-4 type-body-md">This recording isn&apos;t available any more.</p>
            <Footer>
              <Button onClick={() => close()}>Close</Button>
            </Footer>
          </>
        ) : null}

        {stage.kind === "failed" ? (
          <FailedView
            capture={stage.capture}
            onTryAgain={async () => {
              const result = await retryCapture(stage.capture.id);
              if (!result.ok) {
                toast.error(result.message);
                return;
              }
              toWaiting(result.data.capture);
            }}
            onDiscard={async () => {
              await discardCapture(stage.capture.id);
              announceVoiceChange();
              close();
              toast("Discarded.");
            }}
          />
        ) : null}

        {stage.kind === "review" ? (
          <ReviewPanel
            // A fresh form for each capture.
            key={stage.capture.id}
            capture={stage.capture}
            confirmingClose={confirmingClose}
            onDirtyChange={setReviewDirty}
            onKeepReviewing={() => setConfirmingClose(false)}
            onReviewLater={() => {
              setConfirmingClose(false);
              close();
              toast("Saved under Voice captures in your Inbox.");
            }}
            onDone={() => {
              announceVoiceChange();
              close();
            }}
            onDiscarded={() => {
              announceVoiceChange();
              close();
              toast("Discarded.");
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="mt-6 flex justify-end gap-2">{children}</div>;
}

function Progress({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mt-5" role="status" aria-live="polite">
      <p className="type-label-caps text-muted-foreground">{label}</p>
      <div className="mt-3 flex flex-col gap-2" aria-hidden>
        {[88, 64, 40].map((width) => (
          <div
            key={width}
            className="h-2.5 rounded-sm bg-accent motion-safe:animate-pulse"
            style={{ width: `${width}%` }}
          />
        ))}
      </div>
      <p className="mt-4 type-body-sm text-muted-foreground">{hint}</p>
    </div>
  );
}

function FailedView({
  capture,
  onTryAgain,
  onDiscard,
}: {
  capture: VoiceCaptureDTO;
  onTryAgain: () => Promise<void>;
  onDiscard: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  // A capture whose recording is gone cannot be run again.
  const canRetry = capture.hasAudio && capture.errorCode !== "AI_DISABLED";
  return (
    <>
      <Alert className="mt-4">{failureText(capture.errorCode)}</Alert>
      <Footer>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onDiscard();
          }}
        >
          <Trash2 strokeWidth={1.5} aria-hidden /> Discard
        </Button>
        {canRetry ? (
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onTryAgain();
              setBusy(false);
            }}
          >
            Try again
          </Button>
        ) : null}
      </Footer>
    </>
  );
}

function RecorderView({
  recorder,
  state,
  confirmingClose,
  onKeepRecording,
  onDiscardRecording,
  onTypeInstead,
  onStart,
}: {
  recorder: ReturnType<typeof useRecorder>["recorder"];
  state: ReturnType<typeof useRecorder>["state"];
  confirmingClose: boolean;
  onKeepRecording: () => void;
  onDiscardRecording: () => void;
  onTypeInstead: () => void;
  onStart: () => void;
}) {
  const remaining = VOICE_MAX_MS - state.elapsedMs;
  const counting = remaining <= VOICE_COUNTDOWN_MS;
  const active = state.phase === "recording" || state.phase === "paused";

  if (state.phase === "denied") {
    return (
      <>
        <Alert className="mt-4">
          The microphone is blocked. To record, allow microphone access for this site in your
          browser&apos;s address bar or settings, then try again.
        </Alert>
        <Footer>
          <Button variant="secondary" onClick={onTypeInstead}>
            Type it instead
          </Button>
          <Button onClick={onStart}>Try again</Button>
        </Footer>
      </>
    );
  }
  if (state.phase === "unsupported") {
    return (
      <>
        <Alert className="mt-4">This browser can&apos;t record audio.</Alert>
        <Footer>
          <Button onClick={onTypeInstead}>Type it instead</Button>
        </Footer>
      </>
    );
  }
  if (state.phase === "error") {
    return (
      <>
        <Alert className="mt-4">
          {state.error === "no-microphone"
            ? "No microphone was found. Connect one and try again."
            : "Couldn't start the microphone. Try again."}
        </Alert>
        <Footer>
          <Button variant="secondary" onClick={onTypeInstead}>
            Type it instead
          </Button>
          <Button onClick={onStart}>Try again</Button>
        </Footer>
      </>
    );
  }

  return (
    <div className="mt-4">
      {state.tooShort ? (
        <p role="status" className="mb-3 type-body-md text-muted-foreground">
          That was too short to keep. Tap the microphone and speak for a moment.
        </p>
      ) : null}

      <div className="flex flex-col items-center gap-4 py-4">
        {active ? (
          <>
            <LevelMeter level={state.level} active={state.phase === "recording"} />
            <p
              role="timer"
              aria-label="Recording time"
              className={cn(
                "type-headline-md tabular-nums",
                counting && state.phase === "recording" && "text-warning",
              )}
            >
              {clock(state.elapsedMs)}
              {counting ? (
                <span className="ml-2 type-body-md text-warning">
                  {clock(Math.max(0, remaining))} left
                </span>
              ) : null}
            </p>
            {counting ? (
              <p className="sr-only" role="status" aria-live="polite">
                {`${Math.max(0, Math.ceil(remaining / 10_000) * 10)} seconds left`}
              </p>
            ) : null}
            <p role="status" aria-live="polite" className="type-body-md text-muted-foreground">
              {state.phase === "paused" ? "Paused" : "Recording…"}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onStart}
              disabled={state.phase === "asking"}
              aria-label="Start recording"
              className="flex size-20 cursor-pointer items-center justify-center rounded-full bg-primary text-primary-foreground transition-colors duration-[120ms] hover:bg-primary-strong disabled:opacity-60"
            >
              <Mic className="size-8" strokeWidth={1.5} aria-hidden />
            </button>
            <p className="type-body-md text-muted-foreground" role="status" aria-live="polite">
              {state.phase === "asking"
                ? "Waiting for microphone permission…"
                : "Tap to record. Up to 5 minutes."}
            </p>
          </>
        )}
      </div>

      {confirmingClose ? (
        <Alert className="mt-2">
          <p>Stop and throw this recording away?</p>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" onClick={onKeepRecording}>
              Keep recording
            </Button>
            <Button variant="destructive" onClick={onDiscardRecording}>
              Discard
            </Button>
          </div>
        </Alert>
      ) : null}

      {active ? (
        <Footer>
          <Button variant="secondary" onClick={() => recorder.cancel()}>
            Cancel
          </Button>
          {state.phase === "recording" ? (
            <Button variant="secondary" onClick={() => recorder.pause()}>
              <Pause strokeWidth={1.5} aria-hidden /> Pause
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => recorder.resume()}>
              <Play strokeWidth={1.5} aria-hidden /> Resume
            </Button>
          )}
          <Button onClick={() => recorder.finish()}>
            <Square strokeWidth={1.5} aria-hidden /> Done
          </Button>
        </Footer>
      ) : (
        <Footer>
          <Button variant="ghost" onClick={onTypeInstead}>
            Type it instead
          </Button>
        </Footer>
      )}
    </div>
  );
}
