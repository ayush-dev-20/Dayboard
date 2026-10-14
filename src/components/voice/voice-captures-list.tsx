"use client";

import { Mic } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { discardCapture, listCaptures, retryCapture } from "@/lib/voice/client/api";
import { listRecordings, deleteRecording } from "@/lib/voice/client/local-store";
import { daysLeft } from "@/lib/voice/retention";
import { isWorking, type VoiceCaptureDTO } from "@/lib/voice/types";
import { useVoiceAvailable } from "./use-voice-available";
import { announceVoiceChange, requestVoice, VOICE_CHANGED_EVENT } from "./voice-context";

// The Voice captures section of the Inbox (V2 feature 13 §7): recordings still in play, each with its age,
// length and status, and the one thing to do next. Recordings still on this device (made offline) are
// listed first. Nothing renders when there is nothing to show or voice is off.

type DeviceItem = { id: string; durationMs: number; createdAt: number };

const clock = (ms: number) => {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

function ago(from: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - from) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

function statusOf(capture: VoiceCaptureDTO): string {
  switch (capture.status) {
    case "UPLOADING":
      return "Uploading";
    case "QUEUED":
    case "TRANSCRIBING":
      return "Transcribing";
    case "READY":
      return "Ready to review";
    default:
      return capture.errorCode === "RATE_LIMITED"
        ? "Waiting for the AI limit"
        : "Couldn't transcribe";
  }
}

export function VoiceCapturesList() {
  const available = useVoiceAvailable();
  const { userId } = useWorkspace();
  const [captures, setCaptures] = useState<VoiceCaptureDTO[]>([]);
  const [device, setDevice] = useState<DeviceItem[]>([]);
  const [now, setNow] = useState(() => Date.now());

  // Asks the server and this device what is waiting. State is only set in the callbacks, never in an effect body.
  const load = useCallback(async () => {
    const [local, remote] = await Promise.all([
      userId ? listRecordings(userId) : Promise.resolve([]),
      listCaptures(),
    ]);
    return { local, remote };
  }, [userId]);

  const apply = useCallback((data: Awaited<ReturnType<typeof load>>) => {
    setDevice(
      data.local.map((r) => ({ id: r.id, durationMs: r.durationMs, createdAt: r.createdAt })),
    );
    if (data.remote.ok) setCaptures(data.remote.data.captures);
    setNow(Date.now());
  }, []);

  const refresh = useCallback(async () => apply(await load()), [apply, load]);

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const again = () =>
      void load().then((data) => {
        if (!cancelled) apply(data);
      });
    again();
    window.addEventListener(VOICE_CHANGED_EVENT, again);
    window.addEventListener("online", again);
    return () => {
      cancelled = true;
      window.removeEventListener(VOICE_CHANGED_EVENT, again);
      window.removeEventListener("online", again);
    };
  }, [available, load, apply]);

  // While anything is being transcribed, look again every few seconds.
  const working = captures.some((c) => isWorking(c.status));
  useEffect(() => {
    if (!available || !working) return;
    const timer = setInterval(() => void refresh(), 4000);
    return () => clearInterval(timer);
  }, [available, working, refresh]);

  if (!available || (captures.length === 0 && device.length === 0)) return null;

  async function discard(id: string, fromDevice: boolean) {
    if (fromDevice) await deleteRecording(userId, id);
    else await discardCapture(id);
    announceVoiceChange();
    await refresh();
    toast("Discarded.");
  }

  async function retry(id: string) {
    const result = await retryCapture(id);
    if (!result.ok) toast.error(result.message);
    announceVoiceChange();
    await refresh();
  }

  return (
    <section aria-label="Voice captures" className="mt-6">
      <h2 className="flex items-center gap-2 pb-2 type-label-caps text-muted-foreground">
        <Mic className="size-4" strokeWidth={1.5} aria-hidden />
        Voice captures
        <span className="type-data-sm">{captures.length + device.length}</span>
      </h2>
      <ul className="border-t border-border">
        {device.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="type-body-md">Recording on this device</p>
              <p className="type-body-sm text-muted-foreground">
                {clock(item.durationMs)} · {ago(item.createdAt, now)} · Saved on this device.
                We&apos;ll transcribe it when you&apos;re back online.
              </p>
            </div>
            <Button variant="ghost" onClick={() => void discard(item.id, true)}>
              Discard
            </Button>
          </li>
        ))}
        {captures.map((capture) => {
          const left = daysLeft(new Date(capture.expiresAt), new Date(now));
          return (
            <li
              key={capture.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="type-body-md">
                  {statusOf(capture)}
                  <span className="text-muted-foreground">
                    {" "}
                    · {clock(capture.durationMs)} ·{" "}
                    {ago(new Date(capture.createdAt).getTime(), now)}
                  </span>
                </p>
                <p className="type-body-sm text-muted-foreground">
                  {left <= 1 ? "Deleted today" : `Deleted in ${left} days`}
                </p>
              </div>
              {capture.status === "READY" ? (
                <Button variant="secondary" onClick={() => requestVoice({ captureId: capture.id })}>
                  Review
                </Button>
              ) : null}
              {capture.status === "FAILED" && capture.hasAudio ? (
                <Button variant="secondary" onClick={() => void retry(capture.id)}>
                  Retry
                </Button>
              ) : null}
              {isWorking(capture.status) ? (
                <Button variant="secondary" onClick={() => requestVoice({ captureId: capture.id })}>
                  Open
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => void discard(capture.id, false)}>
                Discard
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
