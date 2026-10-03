"use client";

import { toast } from "sonner";
import {
  AiFailureNotice,
  AiGenerating,
  AiLabel,
  GrowingAiPanel,
  StreamCaret,
} from "@/components/ai/ai-ui";
import type { StreamState } from "@/components/ai/use-ai";
import { parseSummary, summaryToPlainText } from "@/lib/ai/summary";

type Props = {
  state: StreamState;
  onRetry: () => void;
  onDismiss: () => void;
  onInsert: () => void;
};

/**
 * A streamed note summary: three labelled sections as text and lists, then Insert into note, Copy
 * and Dismiss. Nothing is added to the note unless the person clicks Insert.
 */
export function SummaryPanel({ state, onRetry, onDismiss, onInsert }: Props) {
  if (state.status === "idle") return null;

  if (state.status === "failed" && !state.data.text) {
    return (
      <AiFailureNotice
        className="mb-4"
        error={state.error}
        text="Couldn’t summarize this note. Nothing was changed."
        onRetry={onRetry}
        onDismiss={onDismiss}
      />
    );
  }

  const sections = parseSummary(state.data.text);
  const streaming = state.status === "generating";

  return (
    <div className="mb-4">
      <GrowingAiPanel label="Note summary" busy={streaming}>
        {streaming && sections.length === 0 ? (
          <AiGenerating label="Generating" />
        ) : (
          <>
            <AiLabel>{streaming ? "Generating" : "AI-generated"}</AiLabel>
            <div className="mt-2 flex flex-col gap-4" aria-live="polite">
              {sections.map((section) => (
                <div key={section.heading}>
                  <h3 className="type-label-md font-semibold">{section.heading}</h3>
                  {section.paragraphs.map((p, i) => (
                    <p key={i} className="mt-1 type-body-md">
                      {p}
                    </p>
                  ))}
                  {section.bullets.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5 type-body-md">
                      {section.bullets.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
              {streaming ? (
                <p className="-mt-3">
                  <StreamCaret />
                </p>
              ) : null}
            </div>
            {state.status === "failed" ? (
              <AiFailureNotice
                className="mt-3"
                error={state.error}
                text="The summary stopped early."
                onRetry={onRetry}
              />
            ) : null}
          </>
        )}
      </GrowingAiPanel>
      {state.status === "complete" ? (
        <div className="mt-2 flex items-center gap-4">
          <button type="button" onClick={onInsert} className="type-body-md text-primary underline">
            Insert into note
          </button>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard
                .writeText(summaryToPlainText(sections))
                .then(() => toast("Copied."))
                .catch(() => toast.error("Couldn’t copy that."));
            }}
            className="type-body-md text-primary underline"
          >
            Copy
          </button>
          <button type="button" onClick={onDismiss} className="type-body-md text-primary underline">
            Dismiss
          </button>
        </div>
      ) : null}
    </div>
  );
}
