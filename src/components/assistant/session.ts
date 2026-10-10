"use client";

import { useSyncExternalStore } from "react";
import { streamAI, type AIFailure } from "@/components/ai/ai-client";
import { trimHistory } from "@/lib/ai/assistant/history";
import type { Proposal } from "@/lib/ai/assistant-types";
import type { AskSource, StreamEvent } from "@/lib/ai/types";
import {
  getThreadSnapshot,
  titleFrom,
  updateThread,
  type StoredMessage,
  type StoredProposal,
} from "./threads";

// One assistant turn at a time, in this browser (V2 feature 11 §4, §6). The streaming answer lives
// here while it arrives and is written into the thread when it ends, so the page and the floating
// panel (which show the same thread) agree. Nothing here writes workspace data: proposals only
// arrive as cards; applying one is a separate, explicit Server Action.

export type LiveTurn = {
  threadId: string;
  text: string;
  sources: AskSource[];
  quotes: string[];
  tools: string[];
  proposals: Proposal[];
  /** True once the server sent the final sources event. */
  final: boolean;
};

let live: LiveTurn | null = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The answer that is arriving for this thread, or null. Same object until it changes. */
export function useLiveTurn(threadId: string | null): LiveTurn | null {
  return useSyncExternalStore(
    subscribe,
    () => (live && live.threadId === threadId ? live : null),
    () => null,
  );
}

/** True while any answer is arriving, in any thread: only one runs at a time. */
export function useAnyGenerating(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => live !== null,
    () => false,
  );
}

const newId = () => crypto.randomUUID();

function apply(event: StreamEvent) {
  if (!live) return;
  if (event.type === "text") live = { ...live, text: live.text + event.delta };
  else if (event.type === "tool") {
    if (event.status === "start" && !live.tools.includes(event.name)) {
      live = { ...live, tools: [...live.tools, event.name] };
    }
  } else if (event.type === "sources") {
    live = { ...live, sources: event.sources, quotes: event.quotes, final: true };
  } else if (event.type === "assistant-proposal") {
    live = { ...live, proposals: [...live.proposals, event.proposal] };
  }
  notify();
}

async function runTurn(threadId: string) {
  const thread = getThreadSnapshot(threadId);
  if (!thread || live) return;
  const history = trimHistory(
    thread.messages
      .filter((m) => !m.failure && m.text.trim() !== "")
      .map((m) => ({ role: m.role, text: m.text })),
  );
  if (history.length === 0) return;

  live = { threadId, text: "", sources: [], quotes: [], tools: [], proposals: [], final: false };
  controller = new AbortController();
  notify();

  const body: { messages: typeof history; contexts?: { type: string; id: string }[] } = {
    messages: history,
  };
  if (thread.chips.length > 0) body.contexts = thread.chips.map(({ type, id }) => ({ type, id }));

  const outcome = await streamAI("/api/ai/assistant", body, apply, controller.signal);
  const finished = live;
  live = null;
  controller = null;

  if (finished) {
    const aborted = !outcome.ok && outcome.error.code === "ABORTED";
    const empty = finished.text.trim() === "" && finished.proposals.length === 0;
    if (!(aborted && empty)) {
      const proposals: StoredProposal[] = finished.proposals.map((proposal) => ({
        proposal,
        status: "pending",
      }));
      const message: StoredMessage = {
        id: newId(),
        role: "assistant",
        text: finished.text,
        at: Date.now(),
        sources: finished.sources,
        quotes: finished.quotes,
        tools: finished.tools,
        ...(proposals.length ? { proposals } : {}),
        ...(aborted ? { stopped: true } : {}),
        ...(!outcome.ok && !aborted ? { failure: failureOf(outcome.error) } : {}),
      };
      updateThread(threadId, (t) => ({ ...t, messages: [...t.messages, message] }));
    }
  }
  notify();
}

const failureOf = (error: AIFailure) => ({
  code: error.code,
  message: error.message,
  ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
});

/** Adds the person's question to the thread and asks. Does nothing while another answer is arriving. */
export async function sendMessage(threadId: string, text: string) {
  const question = text.trim();
  if (!question || live) return;
  updateThread(threadId, (t) => ({
    ...t,
    title: t.messages.length === 0 ? titleFrom(question) : t.title,
    messages: [...t.messages, { id: newId(), role: "user", text: question, at: Date.now() }],
  }));
  await runTurn(threadId);
}

/** Asks again after a failed or stopped answer, without repeating the question in the thread. */
export async function retryTurn(threadId: string) {
  if (live) return;
  updateThread(threadId, (t) => {
    const last = t.messages.at(-1);
    return last && last.role === "assistant" && (last.failure || last.stopped)
      ? { ...t, messages: t.messages.slice(0, -1) }
      : t;
  });
  await runTurn(threadId);
}

/** Stop: the answer so far stays in the thread, marked as stopped. */
export function stopTurn() {
  controller?.abort();
}
