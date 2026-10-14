"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { useCommandMenu } from "@/components/command/command-context";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useMounted, useVoiceAvailable } from "./use-voice-available";
import { requestVoice } from "./voice-context";

/**
 * `/capture`: opens straight into the recorder from the home screen shortcut. Without voice (off, no
 * microphone support, or no `?voice=1`) it opens the quick capture box instead, so the shortcut never
 * leads nowhere. Today stays behind it.
 */
export function CaptureLauncher() {
  const router = useRouter();
  const wantsVoice = useSearchParams().get("voice") === "1";
  const command = useCommandMenu();
  const { voiceEnabled } = useWorkspace();
  const available = useVoiceAvailable();
  // The microphone check is only known in the browser, so decide once this is mounted.
  const ready = useMounted();
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    router.replace("/today");
    if (wantsVoice && voiceEnabled && available) requestVoice();
    else command.open("capture");
  }, [ready, wantsVoice, voiceEnabled, available, command, router]);

  return <p className="sr-only">Opening capture…</p>;
}
