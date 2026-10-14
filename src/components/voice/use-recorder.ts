"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { VoiceRecorder, type LevelMeter, type RecorderState } from "@/lib/voice/recorder";

// The browser's microphone, recorder and clock handed to the recorder's state machine
// (`src/lib/voice/recorder.ts`), as a React hook. Nothing here runs a microphone until `start()`.

/** Loudness from the stream, read about ten times a second. Null where Web Audio is missing. */
function createMeter(stream: unknown): LevelMeter | null {
  const Context =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  try {
    const audio = new Context();
    const source = audio.createMediaStreamSource(stream as MediaStream);
    const analyser = audio.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    return {
      read() {
        analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const sample of samples) {
          const centred = (sample - 128) / 128;
          sum += centred * centred;
        }
        // Speech sits low in the range, so it is lifted to fill the meter.
        return Math.min(1, Math.sqrt(sum / samples.length) * 4);
      },
      close() {
        source.disconnect();
        void audio.close().catch(() => undefined);
      },
    };
  } catch {
    return null;
  }
}

/** Whether this browser can record at all. False on the server and in browsers without MediaRecorder. */
export function canRecordHere(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

export function useRecorder() {
  const recorder = useMemo(
    () =>
      new VoiceRecorder({
        getUserMedia:
          typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
            ? (constraints) => navigator.mediaDevices.getUserMedia(constraints)
            : undefined,
        Recorder: typeof window !== "undefined" ? (window.MediaRecorder as never) : undefined,
        createMeter,
      }),
    [],
  );
  // The microphone is released if the component goes away mid-recording.
  useEffect(() => () => recorder.dispose(), [recorder]);
  const state = useSyncExternalStore<RecorderState>(
    recorder.subscribe,
    recorder.getState,
    recorder.getState,
  );
  return { recorder, state };
}
