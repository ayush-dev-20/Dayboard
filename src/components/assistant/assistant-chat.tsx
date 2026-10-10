"use client";

import { ArrowUp, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { MESSAGE_MAX, type ContextChip, type ContextRef } from "@/lib/ai/assistant-types";
import { cn } from "@/lib/utils";
import { AddItem } from "./add-item";
import { addChips, ChipsBar, FULL_MESSAGE } from "./chips";
import { AnswerView, UserMessage } from "./message-view";
import { usePageItem } from "./page-item";
import { retryTurn, sendMessage, stopTurn, useAnyGenerating, useLiveTurn } from "./session";
import {
  createThread,
  patchThread,
  setCurrentThread,
  useCurrentThreadId,
  useThread,
} from "./threads";

// The conversation itself (V2 feature 11 §6), shared by the Assistant page and the floating panel:
// the thread as a log, the items it answers from, and the composer. The thread is the person's own,
// stored in this browser.

const subscribeOnline = (notify: () => void) => {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
};
const useOffline = () =>
  !useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );

const NOTE_PROMPTS = ["Summarize this", "Turn this into tasks", "What is missing here?"];
const ITEM_PROMPTS = ["Summarize this", "What is open here?", "What is overdue here?"];
const OPEN_PROMPTS = ["What did I write about …?", "What is overdue?", "What is due today?"];
const TYPE_WORD = { note: "note", task: "task", project: "project" } as const;

type Props = {
  /** `panel` is the compact floating version: tighter spacing, no side list. */
  variant: "page" | "panel";
  className?: string;
};

export function AssistantChat({ variant, className }: Props) {
  const threadId = useCurrentThreadId();
  const thread = useThread(threadId);
  const live = useLiveTurn(threadId);
  const offline = useOffline();
  const pageItem = usePageItem();
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);

  const messages = thread?.messages ?? [];
  const chips = thread?.chips ?? [];
  const generating = live !== null;
  // One answer at a time: while any thread is answering, Send waits and Stop is offered.
  const busy = useAnyGenerating();
  const lastIndex = messages.length - 1;

  // Stay at the newest message while an answer arrives; leave the person alone if they scrolled up.
  const nearBottom = useRef(true);
  useLayoutEffect(() => {
    const el = log.current;
    if (el && nearBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages.length, live?.text, live?.proposals.length]);

  function ensureThread(): string {
    return threadId ?? createThread();
  }

  async function submit(text: string = draft) {
    const question = text.trim();
    if (!question || busy || offline) return;
    const id = ensureThread();
    setDraft("");
    nearBottom.current = true;
    await sendMessage(id, question);
  }

  async function add(refs: ContextRef[]) {
    const id = ensureThread();
    const result = await addChips(id, refs);
    if (result.refused === "full") toast(FULL_MESSAGE);
    else if (result.added === 0 && result.refused === "missing")
      toast.error("That item isn't available to ask about.");
  }

  const removeChip = (chip: ContextChip) =>
    threadId &&
    patchThread(threadId, (t) => ({
      ...t,
      chips: t.chips.filter((c) => !(c.type === chip.type && c.id === chip.id)),
    }));

  const prompts =
    chips.length === 0
      ? OPEN_PROMPTS
      : chips.some((c) => c.type === "note")
        ? NOTE_PROMPTS
        : ITEM_PROMPTS;
  const empty = messages.length === 0 && !live;
  const remaining = MESSAGE_MAX - draft.length;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="assistant-chat">
      <div
        ref={log}
        role="log"
        aria-label="Conversation"
        aria-live="off"
        onScroll={(event) => {
          const el = event.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto",
          variant === "panel" ? "px-4 py-3" : "py-2 pr-4",
        )}
      >
        {empty ? (
          <div className="flex flex-col gap-3 py-2" data-testid="assistant-empty">
            <p className="type-body-md text-muted-foreground">
              Ask about your notes, tasks and projects. Answers use only what is in your workspace,
              and nothing changes until you confirm it.
            </p>
            <ul className="flex flex-col gap-1.5" aria-label="Starter prompts">
              {prompts.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(prompt.endsWith("…?") ? prompt.replace("…?", "") : prompt);
                      input.current?.focus();
                    }}
                    className="min-h-11 w-full cursor-pointer rounded-md border border-border px-3 text-left type-body-md hover:bg-accent md:min-h-9"
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
            {pageItem && !chips.some((c) => c.type === pageItem.type && c.id === pageItem.id) ? (
              <div>
                <Button variant="secondary" onClick={() => void add([pageItem])}>
                  Ask about this {TYPE_WORD[pageItem.type]}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {messages.map((message, i) =>
          message.role === "user" ? (
            <UserMessage key={message.id} text={message.text} />
          ) : (
            <AnswerView
              key={message.id}
              threadId={thread!.id}
              message={message}
              text={message.text}
              sources={message.sources ?? []}
              quotes={message.quotes ?? []}
              final
              tools={message.tools ?? []}
              streaming={false}
              proposals={message.proposals ?? []}
              failure={message.failure}
              stopped={message.stopped}
              onRetry={
                i === lastIndex && !generating ? () => void retryTurn(thread!.id) : undefined
              }
            />
          ),
        )}

        {live ? (
          <AnswerView
            threadId={live.threadId}
            text={live.text}
            sources={live.sources}
            quotes={live.quotes}
            final={live.final}
            tools={live.tools}
            streaming
            proposals={[]}
          />
        ) : null}
        {/* One calm announcement when an answer is complete (never per chunk). */}
        <p role="status" className="sr-only">
          {!generating && messages.at(-1)?.role === "assistant" ? "Answer complete." : ""}
        </p>
      </div>

      <div
        className={cn(
          "flex flex-col gap-2 border-t border-border bg-background",
          variant === "panel" ? "px-4 pt-3 pb-4" : "pt-3",
        )}
      >
        <ChipsBar
          chips={chips}
          onRemove={removeChip}
          onClear={() => threadId && patchThread(threadId, (t) => ({ ...t, chips: [] }))}
        />
        {offline ? (
          <p role="status" className="type-body-sm text-muted-foreground">
            The assistant needs a connection.{" "}
            <a href="/search" className="text-primary underline">
              Search still works.
            </a>
          </p>
        ) : null}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor={`assistant-input-${variant}`} className="sr-only">
            Message the assistant
          </label>
          <textarea
            id={`assistant-input-${variant}`}
            ref={input}
            value={draft}
            rows={2}
            maxLength={MESSAGE_MAX}
            placeholder={
              chips.length === 1
                ? `Ask about “${chips[0]!.title || "Untitled"}”…`
                : chips.length > 1
                  ? "Ask about these items…"
                  : "Ask your workspace…"
            }
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
            className="block max-h-40 min-h-16 w-full resize-none rounded-md border border-input bg-background px-3 py-2 type-body-md text-foreground placeholder:text-muted-foreground"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AddItem onPick={(item) => void add([{ type: item.type, id: item.id }])} />
              {remaining <= 500 ? (
                <span
                  className={cn(
                    "type-data-sm",
                    remaining <= 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                  aria-live="polite"
                >
                  {remaining} left
                </span>
              ) : null}
            </div>
            {busy ? (
              <Button variant="secondary" onClick={stopTurn} aria-label="Stop">
                <Square className="size-3.5 fill-current" strokeWidth={1.5} aria-hidden /> Stop
              </Button>
            ) : (
              <Button type="submit" disabled={draft.trim() === "" || offline}>
                <ArrowUp strokeWidth={1.5} aria-hidden /> Send
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/** Starts an empty chat (the "New chat" actions). */
export function newChat() {
  const id = createThread();
  setCurrentThread(id);
  return id;
}
