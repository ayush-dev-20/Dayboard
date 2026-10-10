"use client";

import Link from "next/link";
import { ChevronDown, FileText, Folder, ListChecks } from "lucide-react";
import { useId, useState } from "react";
import { AiFailureNotice, AiLabel, GrowingAiPanel } from "@/components/ai/ai-ui";
import { AnswerBody } from "@/components/ai/answer-body";
import { Button } from "@/components/ui/button";
import { splitAnswer } from "@/lib/ai/answer";
import { TOOL_LABELS, TOOL_PROGRESS, type ToolName } from "@/lib/ai/assistant-types";
import { explainReasons } from "@/lib/ai/assistant/reasons";
import { NOTHING_FOUND_TEXT, type AskSource } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { ProposalCard } from "./proposal-card";
import type { StoredMessage, StoredProposal } from "./threads";

// One message of the thread (V2 feature 11 §6): the person's words as plain text; the assistant's
// answer in the tinted AI panel labelled "AI-generated", with the sources it used as links, a "Why"
// for each, a quiet line saying what it looked through, and any suggestions as cards to confirm.

const TYPE_LABEL = {
  note: "Note",
  task: "Task",
  project: "Project",
  todo: "Todo",
  tag: "Tag",
} as const;
const TYPE_ICON = {
  note: FileText,
  task: ListChecks,
  project: Folder,
  todo: ListChecks,
  tag: FileText,
} as const;

/** "Searched your workspace" and friends, from the tools that ran. Plain words, never "thinking". */
export function toolLine(tools: string[] | undefined, streaming = false): string | null {
  if (!tools || tools.length === 0) return null;
  const table = streaming ? TOOL_PROGRESS : TOOL_LABELS;
  const labels = [
    ...new Set(
      tools
        .filter((name) => name !== "proposeTaskChanges" || streaming)
        .map((name) => table[name as ToolName])
        .filter((l): l is string => Boolean(l)),
    ),
  ];
  return labels.length ? labels.join(" · ") : null;
}

type AnswerProps = {
  threadId: string;
  /** Present for a stored message; absent for the answer that is still arriving. */
  message?: StoredMessage;
  text: string;
  sources: AskSource[];
  quotes: string[];
  final: boolean;
  tools: string[];
  streaming: boolean;
  proposals: StoredProposal[];
  failure?: StoredMessage["failure"];
  stopped?: boolean;
  /** Retry is offered on the newest answer only. */
  onRetry?: () => void;
};

export function AnswerView(props: AnswerProps) {
  const { text, sources, quotes, final, tools, streaming, failure, stopped } = props;
  const parts = splitAnswer(text, sources, quotes, final);
  const line = toolLine(tools, streaming);

  // "I couldn't find anything" is not an AI answer, so it carries no AI label.
  if (!streaming && !failure && text.trim() === NOTHING_FOUND_TEXT) {
    return (
      <div className="flex flex-col gap-1.5" data-testid="assistant-message">
        {line ? <p className="type-body-sm text-muted-foreground">{line}</p> : null}
        <p role="status" className="type-body-md">
          {NOTHING_FOUND_TEXT}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2" data-testid="assistant-message">
      {line ? (
        <p className="type-body-sm text-muted-foreground" data-testid="tool-line">
          {line}
        </p>
      ) : null}
      {parts.length > 0 || streaming ? (
        <GrowingAiPanel label="Answer" busy={streaming}>
          <AiLabel>{streaming ? "Generating" : "AI-generated"}</AiLabel>
          {/* Not a live region while it streams: it is announced once, when it is complete. */}
          <div className="mt-2 flex flex-col gap-2">
            <AnswerBody parts={parts} streaming={streaming} />
            {streaming && parts.length === 0 ? (
              <div className="flex flex-col gap-2" aria-hidden>
                <div className="h-2.5 w-4/5 rounded-sm bg-accent motion-safe:animate-pulse" />
                <div className="h-2.5 w-3/5 rounded-sm bg-accent motion-safe:animate-pulse" />
              </div>
            ) : null}
          </div>
          {sources.length > 0 ? <SourceList sources={sources} /> : null}
          {stopped ? <p className="mt-2 type-body-sm text-muted-foreground">Stopped.</p> : null}
        </GrowingAiPanel>
      ) : null}

      {props.message && props.proposals.length > 0
        ? props.proposals.map((stored, i) => (
            <ProposalCard
              key={stored.proposal.id}
              threadId={props.threadId}
              messageId={props.message!.id}
              index={i}
              stored={stored}
            />
          ))
        : null}

      {failure ? (
        <AiFailureNotice
          error={failure}
          text={text ? "The answer stopped early." : "Couldn’t get an answer. Nothing was changed."}
          onRetry={props.onRetry}
        />
      ) : stopped && props.onRetry ? (
        <div>
          <Button variant="secondary" onClick={props.onRetry}>
            Try again
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The sources an answer cited, each a link, with a "Why" that shows what the server recorded. */
function SourceList({ sources }: { sources: AskSource[] }) {
  return (
    <div className="mt-3">
      <p className="type-label-caps text-muted-foreground">Sources</p>
      <ul className="mt-1 flex flex-col" aria-label="Sources">
        {sources.map((source) => (
          <SourceRow key={source.label} source={source} />
        ))}
      </ul>
    </div>
  );
}

function SourceRow({ source }: { source: AskSource }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Icon = TYPE_ICON[source.type];
  const reasons = source.reasons;
  return (
    <li className="border-b border-ai-border py-1 last:border-b-0" data-testid="source">
      <div className="flex min-h-9 items-center gap-2">
        <Icon className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
        <Link
          href={source.href}
          className="min-w-0 flex-1 truncate type-body-md text-primary underline"
        >
          <span className="sr-only">{TYPE_LABEL[source.type]}: </span>
          {source.title || "Untitled"}
        </Link>
        <span className="hidden type-body-sm text-muted-foreground sm:inline" aria-hidden>
          {TYPE_LABEL[source.type]}
        </span>
        {reasons ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-11 shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 type-body-sm text-muted-foreground hover:bg-accent md:h-8"
          >
            Why
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform motion-reduce:transition-none",
                open && "rotate-180",
              )}
              strokeWidth={1.5}
              aria-hidden
            />
          </button>
        ) : null}
      </div>
      {reasons && open ? (
        <div id={panelId} className="pb-2 pl-6 type-body-sm" data-testid="source-why">
          <p>{explainReasons(reasons)}</p>
          {reasons.passage ? (
            <p className="mt-1 border-l-2 border-border pl-3 font-serif text-[14px] leading-5 text-muted-foreground">
              {reasons.passage}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** The person's own message: plain text, no panel, no label. */
export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <p className="max-w-[85%] rounded-lg bg-secondary px-3 py-2 type-body-md whitespace-pre-wrap">
        {text}
      </p>
    </div>
  );
}
