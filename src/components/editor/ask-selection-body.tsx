"use client";

import { ArrowDownToLine, Copy, MessageCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Editor } from "@tiptap/react";
import { toast } from "sonner";
import { AiFailureNotice, AiLabel, StreamCaret } from "@/components/ai/ai-ui";
import { useAIEvents } from "@/components/ai/use-ai";
import { continueInAssistant } from "@/components/assistant/continue-in-assistant";
import { insertBelow, trackRange, type SelectionInfo } from "@/components/editor/ai-apply";
import { useEditorSurface } from "@/components/editor/blocks/context";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { StreamEvent } from "@/lib/ai/types";
import { ASK_QUESTION_MAX, ASK_SELECTION_MAX } from "@/lib/validations/assistant";
import { InstructionForm } from "./instruction-form";

// "Ask AI" on selected text (V2 feature 11 §6B): one question about the selection, one streamed
// answer in the tinted AI panel. Read-only: nothing in the note changes unless the person presses
// Insert below, which is one undo step. No tools and no workspace search here: that is what
// "Continue in assistant" is for.

const PRESETS = ["Explain this", "Summarize", "What is missing?"] as const;

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
  const [asked, setAsked] = useState<string | null>(null);
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
    run({ ownerType: surface.surface, ownerId, selection: info.text, question: value });
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
    const result = insertBelow(editor, range, text);
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
        placeholder="For example: what is the deadline?"
        presets={PRESETS}
        selection={info.text}
        value={question}
        onChange={setQuestion}
        onSubmit={(value) => void submit(value)}
        submitLabel="Ask"
        onCancel={onClose}
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
        <h3 className="type-label-caps text-muted-foreground">From your selection</h3>
        <p
          aria-busy={streaming}
          className="mt-1 max-h-56 min-h-12 overflow-y-auto rounded-md bg-background p-3 type-body-md whitespace-pre-wrap"
        >
          {text}
          {streaming ? <StreamCaret /> : null}
        </p>
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
