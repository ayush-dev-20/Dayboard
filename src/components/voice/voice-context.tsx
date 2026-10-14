"use client";

import { createContext, useContext } from "react";

// What the rest of the app sees of voice capture (V2 feature 13): whether to show the microphone, and
// how to open the recorder or a waiting capture. The default does nothing, so a screen rendered outside
// the app shell (a test, a story) never breaks.

export type VoiceControls = {
  /** Show the microphone: voice is on for this person and this browser can record. */
  enabled: boolean;
  /** Recordings waiting on this device for a connection. */
  pendingOnDevice: number;
  /** Opens the recorder, or, with `captureId`, a capture to review or retry. */
  open: (options?: { captureId?: string }) => void;
};

export const VoiceContext = createContext<VoiceControls>({
  enabled: false,
  pendingOnDevice: 0,
  open: () => {},
});

export const useVoice = () => useContext(VoiceContext);

/** Fired whenever the set of captures may have changed, so the Inbox list can ask again. */
export const VOICE_CHANGED_EVENT = "dayboard:voice-changed";
export const announceVoiceChange = () => window.dispatchEvent(new Event(VOICE_CHANGED_EVENT));

/** Asks the voice dialog to open. Anything can send it, even outside the provider (the command menu is one). */
export const VOICE_OPEN_EVENT = "dayboard:voice-open";
export function requestVoice(options?: { captureId?: string }) {
  window.dispatchEvent(new CustomEvent(VOICE_OPEN_EVENT, { detail: options ?? {} }));
}
