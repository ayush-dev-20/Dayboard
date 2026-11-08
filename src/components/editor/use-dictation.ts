"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import {
  dictationSupported,
  explainDictationError,
  recognitionConstructor,
  speaksEnglish,
  type Recognition,
} from "@/lib/dictation/recognition";

const none = () => () => {};

/** Whether this browser can dictate. False on the server and on the first paint, so no button flashes in and out. */
export function useDictationSupported(): boolean {
  return useSyncExternalStore(none, dictationSupported, () => false);
}

/** Silence ends a recognition session; start again this many times in a row before giving up. */
const MAX_SILENT_RESTARTS = 2;

/**
 * Dictation (the microphone in the editors and capture boxes). `onFinal` gets each finished phrase as the browser heard
 * it, with `commands` saying whether spoken marks apply; the caller formats and inserts it. Listening carries on
 * until the person stops it (the browser ends a session after a pause, so it is started again), they leave, or the
 * microphone is refused. The words being spoken now (`interim`) are shown but never inserted.
 */
export function useDictation(onFinal: (text: string, commands: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const recognition = useRef<Recognition | null>(null);
  const wanted = useRef(false);
  const silentRestarts = useRef(0);
  const handler = useRef(onFinal);
  useEffect(() => {
    handler.current = onFinal;
  });

  const stop = useCallback(() => {
    wanted.current = false;
    recognition.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const begin = useCallback(() => {
    const Ctor = recognitionConstructor();
    if (!Ctor) return;
    const session = new Ctor();
    const lang = navigator.language || "en-US";
    session.lang = lang;
    // Android's recogniser repeats words when it runs continuously: there, one phrase per session and restart.
    session.continuous = !/android/i.test(navigator.userAgent);
    session.interimResults = true;
    session.maxAlternatives = 1;

    session.onresult = (event) => {
      silentRestarts.current = 0;
      let live = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (!result) continue;
        const heard = result[0].transcript;
        if (result.isFinal) handler.current(heard, speaksEnglish(lang));
        else live += heard;
      }
      setInterim(live);
    };
    session.onerror = (event) => {
      if (event.error === "no-speech") return;
      const message = explainDictationError(event.error);
      if (event.error !== "aborted") {
        wanted.current = false;
        setListening(false);
        setInterim("");
      }
      if (message) toast.error(message);
    };
    session.onend = () => {
      setInterim("");
      if (!wanted.current) {
        setListening(false);
        return;
      }
      // A pause ended the session: carry on, unless nothing has been said for a few sessions.
      if (silentRestarts.current >= MAX_SILENT_RESTARTS) {
        wanted.current = false;
        setListening(false);
        return;
      }
      silentRestarts.current += 1;
      try {
        session.start();
      } catch {
        wanted.current = false;
        setListening(false);
      }
    };
    recognition.current = session;
    try {
      session.start();
    } catch {
      wanted.current = false;
      setListening(false);
    }
  }, []);

  const start = useCallback(() => {
    if (wanted.current) return;
    wanted.current = true;
    silentRestarts.current = 0;
    setListening(true);
    begin();
  }, [begin]);

  const toggle = useCallback(() => (wanted.current ? stop() : start()), [start, stop]);

  // Leaving the page, or the editor going away, releases the microphone.
  useEffect(
    () => () => {
      wanted.current = false;
      recognition.current?.abort();
    },
    [],
  );

  return { listening, interim, start, stop, toggle };
}
