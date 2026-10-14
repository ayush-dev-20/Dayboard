"use client";

import { useSyncExternalStore } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { canRecordHere } from "./use-recorder";

const none = () => () => {};

/** True once this is running in a browser (never on the server or during hydration). */
export function useMounted(): boolean {
  return useSyncExternalStore(
    none,
    () => true,
    () => false,
  );
}

/** Whether this browser can record at all. False on the server and during hydration. */
export function useCanRecord(): boolean {
  return useSyncExternalStore(none, canRecordHere, () => false);
}

/**
 * Whether to show a microphone: voice is on for this person (storage, a provider that takes audio, AI and
 * their switch) and this browser can record. False on the server and on the first paint, so a browser
 * without MediaRecorder never flashes a button (V2 feature 13 §3).
 */
export function useVoiceAvailable(): boolean {
  const { voiceEnabled } = useWorkspace();
  const canRecord = useCanRecord();
  return voiceEnabled && canRecord;
}
