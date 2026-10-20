"use client";

import { ArrowDownToLine, Copy, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { AiFailureNotice, AiLabel, StreamCaret } from "@/components/ai/ai-ui";
import { AnswerBody } from "@/components/ai/answer-body";
import { useAIEvents } from "@/components/ai/use-ai";
import { continueInAssistant } from "@/components/assistant/continue-in-assistant";
import {
  insertBelow,
  insertDocBelow,
  trackRange,
  type SelectionInfo,
} from "@/components/editor/ai-apply";
import { useEditorSurface } from "@/components/editor/blocks/context";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  ASK_ANSWER_LABELS,
  ASK_MODE_LABELS,
  ASK_MODES,
  suggestAskMode,
  type AskMode,
} from "@/lib/ai/ask-mode";
import { splitAnswer } from "@/lib/ai/answer";
import type { StreamEvent } from "@/lib/ai/types";
import { markdownToDoc } from "@/lib/editor/markdown";
import { ASK_QUESTION_MAX, ASK_SELECTION_MAX } from "@/lib/validations/assistant";
import { InstructionForm } from "./instruction-form";

// "Ask AI" on selected text (V2 feature 11 §6B): one question about the selection, one streamed
// answer in the tinted AI panel. Read-only: nothing in the note changes unless the person presses
// Insert below, which is one undo step. No tools and no workspace search here: that is what
// "Continue in assistant" is for.

const PRESETS: Record<AskMode, readonly string[]> = {
  note: ["Explain this", "Summarize", "What is missing?"],
  open: ["Answer this", "Give me ideas", "Explain this"],
};
const PLACEHOLDERS: Record<AskMode, string> = {
  note: "For example: what is the deadline?",
  open: "For example: think of a way to do this",
};
const MODE_HINTS: Record<AskMode, string> = {
  note: "Answers only from this note. It says so when the note does not have the answer.",
  open: "Also uses what the AI knows. The answer is labelled as a suggestion, not from your notes.",
};

type Data = { text: string };
const INITIAL: Data = { text: "" };
const reduce = (data: Data, event: StreamEvent): Data =>
  event.type === "text" ? { text: data.text + event.delta } : data;

export function AskSelectionBody({
  editor,
  info,
  onClose,
}: {
  editor: Editor;
  info: SelectionInfo;
  onClose: () => void;
}) {
  const surface = useEditorSurface();
  const { assistantLauncher } = useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const { state, run, retry, stop, reset } = useAIEvents("/api/ai/ask-selection", INITIAL, reduce);
  const [question, setQuestion] = useState("");
  // A selection that is itself a question or a request starts in open mode; the person can change it.
  const [mode, setMode] = useState<AskMode>(() => suggestAskMode(info.text));
  const [asked, setAsked] = useState<string | null>(null);
  // The mode the answer on screen was asked in, so changing the switch later never relabels it.
  const [askedMode, setAskedMode] = useState<AskMode>("note");
  const [problem, setProblem] = useState<string | null>(null);
  const tracker = useRef<ReturnType<typeof trackRange> | null>(null);

  useEffect(() => {
    const track = trackRange(editor, info);
    tracker.current = track;
    return () => {
      track.stop();
      tracker.current = null;
    };
  }, [editor, info]);

  const tooLong = info.text.length > ASK_SELECTION_MAX;
  const streaming = state.status === "generating";
  const text = state.status === "idle" ? "" : state.data.text;
  const done = state.status === "complete" || state.status === "stopped";
  // No sources or quotes here: the answer is the model's own text, split into lines for the formatter.
  const parts = splitAnswer(text, [], [], !streaming);

  async function submit(value: string) {
    if (tooLong) return;
    setProblem(null);
    // A note that has not been saved yet is made first: the answer is read from the saved text.
    const ownerId = surface.ownerId ?? (await surface.ensureOwner?.()) ?? null;
    if (!ownerId) {
      setProblem("Type something in the note first, then ask.");
      return;
    }
    setAsked(value);
    setAskedMode(mode);
    run({ ownerType: surface.surface, ownerId, selection: info.text, question: value, mode });
  }

  async function toAssistant() {
    const ownerId = surface.ownerId ?? (await surface.ensureOwner?.()) ?? null;
    if (!ownerId || asked === null) return;
    const onPage = pathname.startsWith("/assistant");
    await continueInAssistant({
      owner: { type: surface.surface, id: ownerId },
      selection: info.text,
      question: asked,
      answer: text,
      panel: assistantLauncher && !onPage,
    });
    onClose();
    if (!assistantLauncher || onPage) router.push("/assistant");
  }

  function insert() {
    const range = tracker.current?.current();
    if (!range) return;
    // The answer is light Markdown: put it in the note as real headings, lists and bold, not as symbols. If it
    // gives nothing the editor can hold, fall back to plain paragraphs.
    const doc = markdownToDoc(text, { final: true });
    const result =
      (doc.content?.length ?? 0) > 0
        ? insertDocBelow(editor, range, doc)
        : insertBelow(editor, range, text);
    if (result.ok) {
      onClose();
      editor.commands.focus();
    } else {
      setProblem(result.reason);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied.");
    } catch {
      toast.error("Couldn't copy. Select the text and copy it.");
    }
  }

  if (asked === null || state.status === "idle") {
    return (
      <InstructionForm
        title="Ask AI"
        question="Ask about this text"
        placeholder={PLACEHOLDERS[mode]}
        presets={PRESETS[mode]}
        selection={info.text}
        value={question}
        onChange={setQuestion}
        onSubmit={(value) => void submit(value)}
        submitLabel="Ask"
        onCancel={onClose}
        extra={<ModeChoice mode={mode} onChange={setMode} />}
        note={
          tooLong
            ? "Select a shorter passage."
            : question.length > ASK_QUESTION_MAX
              ? `Use ${ASK_QUESTION_MAX} characters or fewer.`
              : problem
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="ask-selection-answer">
      <div className="flex items-baseline justify-between gap-3">
        <AiLabel>{streaming ? "Generating" : "AI-generated"}</AiLabel>
        <p className="type-label-md">Ask AI</p>
      </div>
      <p className="line-clamp-2 type-body-sm text-muted-foreground">
        <span className="font-semibold">You asked:</span> {asked}
      </p>
      <div>
        <h3 className="type-label-caps text-muted-foreground" data-testid="ask-answer-source">
          {ASK_ANSWER_LABELS[askedMode]}
        </h3>
        <div
          aria-busy={streaming}
          className="mt-1 flex max-h-56 min-h-12 flex-col gap-2 overflow-y-auto rounded-md bg-background p-3"
        >
          {/* Shown as formatting (paragraphs, headings, lists, bold), never as Markdown symbols. */}
          <AnswerBody parts={parts} streaming={streaming} />
          {streaming && parts.length === 0 ? <StreamCaret /> : null}
        </div>
      </div>
      <p role="status" className="sr-only">
        {streaming ? "Answering" : done ? "Answer ready" : ""}
      </p>
      {state.status === "failed" ? (
        <AiFailureNotice
          error={state.error}
          text="Couldn’t answer that. Nothing was changed."
          onRetry={retry}
          onDismiss={onClose}
        />
      ) : null}
      {problem ? (
        <p role="alert" className="type-body-sm text-destructive">
          {problem}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {streaming ? (
          <Button variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : null}
        {done && text.trim() !== "" ? (
          <>
            <Button variant="ghost" onClick={() => void copy()}>
              <Copy strokeWidth={1.5} aria-hidden /> Copy
            </Button>
            <Button variant="secondary" onClick={() => void toAssistant()}>
              <MessageCircle strokeWidth={1.5} aria-hidden /> Continue in assistant
            </Button>
            <Button variant="secondary" onClick={insert}>
              <ArrowDownToLine strokeWidth={1.5} aria-hidden /> Insert below
            </Button>
          </>
        ) : null}
        {!streaming ? (
          <Button
            variant="ghost"
            onClick={() => {
              reset();
              setAsked(null);
              setQuestion("");
            }}
          >
            Ask another
          </Button>
        ) : null}
        <Button onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

/**
 * Where the answer may come from: only this note, or the note and the AI's general knowledge. Two plain radio
 * buttons, so nothing is guessed behind the person's back and the choice is announced as it is read.
 */
function ModeChoice({ mode, onChange }: { mode: AskMode; onChange: (mode: AskMode) => void }) {
  return (
    <fieldset className="flex flex-col gap-1.5" data-testid="ask-mode">
      <legend className="type-label-md">Where should the answer come from?</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {ASK_MODES.map((value) => (
          <label
            key={value}
            className="flex min-h-11 cursor-pointer items-center gap-2 type-body-md md:min-h-8"
          >
            <input
              type="radio"
              name="ask-mode"
              value={value}
              checked={mode === value}
              onChange={() => onChange(value)}
              className="size-4 accent-[var(--primary)]"
            />
            {ASK_MODE_LABELS[value]}
          </label>
        ))}
      </div>
      <p className="type-body-sm text-muted-foreground">{MODE_HINTS[mode]}</p>
    </fieldset>
  );
}
