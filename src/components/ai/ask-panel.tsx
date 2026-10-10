"use client";

import { AiFailureNotice, AiLabel, GrowingAiPanel } from "@/components/ai/ai-ui";
import { AnswerBody } from "@/components/ai/answer-body";
import { Button } from "@/components/ui/button";
import type { StreamState } from "@/components/ai/use-ai";
import { splitAnswer } from "@/lib/ai/answer";
import { NOTHING_FOUND_TEXT } from "@/lib/ai/types";

type Props = {
  state: StreamState;
  onRetry: () => void;
  onDismiss: () => void;
  /** Open a source: navigates and closes the menu. */
  onOpen: (href: string) => void;
  /** Continue this question and answer as a conversation on the Assistant page (feature 11 §2). */
  onOpenInAssistant?: () => void;
};

/**
 * The answer in the command menu's Ask mode. The text streams in, then the sources arrive and
 * become links. "From your workspace" marks only quotes the server checked against the records it
 * sent; everything else is the AI's own wording.
 */
export function AskPanel({ state, onRetry, onDismiss, onOpen, onOpenInAssistant }: Props) {
  if (state.status === "idle") {
    return (
      <p className="px-4 py-4 type-body-md text-muted-foreground">
        Ask about your tasks, notes and projects, then press Enter. Answers use only what is in your
        workspace.
      </p>
    );
  }

  if (state.status === "failed" && !state.data.text) {
    return (
      <div className="p-4">
        <AiFailureNotice
          error={state.error}
          text="Couldn’t get an answer. Try again."
          onRetry={onRetry}
          onDismiss={onDismiss}
        />
      </div>
    );
  }

  const { text, sources, quotes, final } = state.data;

  // "I couldn't find anything" is not an AI answer, so it carries no AI label.
  if (state.status === "complete" && text.trim() === NOTHING_FOUND_TEXT) {
    return (
      <p role="status" className="px-4 py-4 type-body-md">
        {NOTHING_FOUND_TEXT}
      </p>
    );
  }

  const parts = splitAnswer(text, sources, quotes, final);
  const streaming = state.status === "generating";

  return (
    <div className="p-4">
      <GrowingAiPanel label="Answer" busy={streaming}>
        <AiLabel>{streaming ? "Generating" : "AI-generated"}</AiLabel>
        <div className="mt-2 flex flex-col gap-2" aria-live="polite">
          <AnswerBody parts={parts} streaming={streaming} />
          {streaming && parts.length === 0 ? (
            <div className="flex flex-col gap-2" aria-hidden>
              <div className="h-2.5 w-4/5 rounded-sm bg-accent motion-safe:animate-pulse" />
              <div className="h-2.5 w-3/5 rounded-sm bg-accent motion-safe:animate-pulse" />
            </div>
          ) : null}
        </div>
        {sources.length > 0 ? (
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 type-body-sm">
            <span className="text-muted-foreground">Sources</span>
            {sources.map((source) => (
              <a
                key={source.label}
                href={source.href}
                onClick={(event) => {
                  event.preventDefault();
                  onOpen(source.href);
                }}
                className="text-primary underline"
              >
                {source.label.slice(1)} {source.title || "Untitled"}
              </a>
            ))}
          </p>
        ) : null}
        {state.status === "failed" ? (
          <AiFailureNotice
            className="mt-3"
            error={state.error}
            text="The answer stopped early."
            onRetry={onRetry}
          />
        ) : null}
      </GrowingAiPanel>
      {state.status === "complete" && onOpenInAssistant ? (
        <div className="mt-3">
          <Button variant="secondary" onClick={onOpenInAssistant}>
            Open in assistant
          </Button>
        </div>
      ) : null}
    </div>
  );
}
