"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AskSource, StreamEvent } from "@/lib/ai/types";
import { callAI, streamAI, type AIFailure } from "./ai-client";

// Every AI surface has the same four states (UI/UX §13): Ready (idle), Generating, Complete and
// Failed with Retry. These hooks hold them. Nothing here writes workspace data.

export type AIState<T> =
  | { status: "idle" }
  | { status: "generating" }
  | { status: "complete"; data: T }
  | { status: "failed"; error: AIFailure };

/** A one-shot structured call. `run(body)` starts it; `retry()` repeats the last body. */
export function useAICall<T>(path: string) {
  const [state, setState] = useState<AIState<T>>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const lastBody = useRef<unknown>(undefined);

  // Leaving the screen cancels the request. (The server may still finish; nothing is written.)
  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(
    async (body: unknown) => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      const result = await callAI<T>(path, body, mine.signal);
      if (mine.signal.aborted) return;
      setState(
        result.ok
          ? { status: "complete", data: result.data }
          : { status: "failed", error: result.error },
      );
    },
    [path],
  );

  const run = useCallback(
    (body: unknown) => {
      lastBody.current = body;
      setState({ status: "generating" });
      void send(body);
    },
    [send],
  );

  const retry = useCallback(() => run(lastBody.current), [run]);

  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, run, retry, reset };
}

export type StreamData = {
  text: string;
  sources: AskSource[];
  quotes: string[];
  /** True once the server sent the final sources event. */
  final: boolean;
};

export type StreamState =
  | { status: "idle" }
  | { status: "generating"; data: StreamData }
  | { status: "complete"; data: StreamData }
  | { status: "failed"; error: AIFailure; data: StreamData };

const EMPTY: StreamData = { text: "", sources: [], quotes: [], final: false };

/** A streamed answer: the text grows as it arrives, then the sources land at the end. */
export function useAIStream(path: string) {
  const [state, setState] = useState<StreamState>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const lastBody = useRef<unknown>(undefined);

  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(
    async (body: unknown) => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      let data: StreamData = EMPTY;

      const outcome = await streamAI(
        path,
        body,
        (event) => {
          if (mine.signal.aborted) return;
          if (event.type === "text") data = { ...data, text: data.text + event.delta };
          else if (event.type === "sources") {
            data = { ...data, sources: event.sources, quotes: event.quotes, final: true };
          }
          setState({ status: "generating", data });
        },
        mine.signal,
      );
      if (mine.signal.aborted) return;
      setState(
        outcome.ok
          ? { status: "complete", data }
          : { status: "failed", error: outcome.error, data },
      );
    },
    [path],
  );

  const run = useCallback(
    (body: unknown) => {
      lastBody.current = body;
      setState({ status: "generating", data: EMPTY });
      void send(body);
    },
    [send],
  );
  const retry = useCallback(() => run(lastBody.current), [run]);
  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, run, retry, reset };
}

export type EventsState<D> =
  | { status: "idle" }
  | { status: "generating"; data: D }
  | { status: "complete"; data: D }
  /** The person pressed Stop. What arrived so far is kept and can still be used. */
  | { status: "stopped"; data: D }
  | { status: "failed"; error: AIFailure; data: D };

/**
 * A streamed answer with its own shape. `reduce` folds each event into `data`; `initial` and
 * `reduce` must not change between renders (declare them at module level). Used by Generate with
 * AI, Plan my day and Writing help. Summarize and Ask keep `useAIStream`.
 */
export function useAIEvents<D>(
  path: string,
  initial: D,
  reduce: (data: D, event: StreamEvent) => D,
) {
  const [state, setState] = useState<EventsState<D>>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const stopping = useRef<AbortController | null>(null);
  const lastBody = useRef<unknown>(undefined);

  useEffect(() => () => controller.current?.abort(), []);

  const send = useCallback(
    async (body: unknown) => {
      controller.current?.abort();
      const mine = new AbortController();
      controller.current = mine;
      let data = initial;

      const outcome = await streamAI(
        path,
        body,
        (event) => {
          if (mine.signal.aborted) return;
          data = reduce(data, event);
          setState({ status: "generating", data });
        },
        mine.signal,
      );

      if (mine.signal.aborted) {
        // Stop keeps what was written; being replaced or leaving the screen keeps nothing.
        if (stopping.current === mine) setState({ status: "stopped", data });
        return;
      }
      setState(
        outcome.ok
          ? { status: "complete", data }
          : { status: "failed", error: outcome.error, data },
      );
    },
    [path, initial, reduce],
  );

  const run = useCallback(
    (body: unknown) => {
      lastBody.current = body;
      setState({ status: "generating", data: initial });
      void send(body);
    },
    [send, initial],
  );
  const retry = useCallback(() => run(lastBody.current), [run]);
  const stop = useCallback(() => {
    stopping.current = controller.current;
    controller.current?.abort();
  }, []);
  const reset = useCallback(() => {
    controller.current?.abort();
    setState({ status: "idle" });
  }, []);

  return { state, run, retry, stop, reset };
}
