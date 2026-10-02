import type { AskSource, StreamEvent } from "@/lib/ai/types";

// How the browser talks to `/api/ai/*`. Errors never throw: every call ends as a plain value the
// screen can show, so a failing AI call can never break the page around it.

export type AIFailure = {
  code: string;
  message: string;
  /** Only for RATE_LIMITED. */
  retryAfterSeconds?: number;
};

export type AIResult<T> = { ok: true; data: T } | { ok: false; error: AIFailure };

const NETWORK_FAILURE: AIFailure = {
  code: "AI_PROVIDER_ERROR",
  message: "Couldn’t reach the AI service. Check your connection and try again.",
};

async function readFailure(response: Response): Promise<AIFailure> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; message?: string; retryAfterSeconds?: number };
    };
    return {
      code: body.error?.code ?? "INTERNAL_ERROR",
      message: body.error?.message ?? "Something went wrong. Try again.",
      retryAfterSeconds: body.error?.retryAfterSeconds,
    };
  } catch {
    return { code: "INTERNAL_ERROR", message: "Something went wrong. Try again." };
  }
}

export async function callAI<T>(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<AIResult<T>> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    if (!response.ok) return { ok: false, error: await readFailure(response) };
    const json = (await response.json()) as { data: T };
    return { ok: true, data: json.data };
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      return { ok: false, error: { code: "ABORTED", message: "" } };
    }
    return { ok: false, error: NETWORK_FAILURE };
  }
}

export async function getAI<T>(path: string, signal?: AbortSignal): Promise<AIResult<T>> {
  try {
    const response = await fetch(path, { signal, cache: "no-store" });
    if (!response.ok) return { ok: false, error: await readFailure(response) };
    const json = (await response.json()) as { data: T };
    return { ok: true, data: json.data };
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      return { ok: false, error: { code: "ABORTED", message: "" } };
    }
    return { ok: false, error: NETWORK_FAILURE };
  }
}

export type StreamOutcome = { ok: true } | { ok: false; error: AIFailure };

/** Reads a streamed route (one JSON event per line) and hands each event to `onEvent`. */
export async function streamAI(
  path: string,
  body: unknown,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<StreamOutcome> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    if (!response.ok) return { ok: false, error: await readFailure(response) };
    if (!response.body) return { ok: false, error: NETWORK_FAILURE };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let failure: AIFailure | null = null;

    const handle = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line) as StreamEvent;
      if (event.type === "error") failure = { code: event.code, message: event.message };
      else onEvent(event);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        handle(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    handle(buffer);
    return failure ? { ok: false, error: failure } : { ok: true };
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      return { ok: false, error: { code: "ABORTED", message: "" } };
    }
    return { ok: false, error: NETWORK_FAILURE };
  }
}

export type { AskSource };
