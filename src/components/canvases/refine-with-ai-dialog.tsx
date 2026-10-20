"use client";

import { useRef, useState } from "react";
import { AiFailureNotice, AiGenerating } from "@/components/ai/ai-ui";
import { useAICall } from "@/components/ai/use-ai";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { DiagramSpec } from "@/lib/canvas/diagram-spec";
import type { ReadBack } from "@/lib/canvas/read-back";
import type { RefineCounts, RefineOp } from "@/lib/canvas/refine";

type Proposal = {
  proposalId: string;
  ops: RefineOp[];
  spec: DiagramSpec;
  counts: RefineCounts;
  summary: string;
  warnings: string[];
};

export type RefineApply = (proposal: Proposal) => Promise<void> | void;

const EXAMPLES = [
  "Add a cache between the API and the database",
  "Add monitoring and logging",
  "Add an admin dashboard",
];

/**
 * "Refine with AI" (V3 feature 01 §7): one instruction about the diagram on the canvas, then a summary of what would change
 * ("Adds 1 box and 2 connections; changes 1 label") before anything does. New parts go into an Additions frame beside the
 * diagram; nothing already drawn is moved, and what is removed is named in the summary. Apply is one undo step. Esc, Discard
 * and closing the dialog change nothing.
 */
export function RefineWithAiDialog({
  open,
  onOpenChange,
  read,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The diagram as it is on the canvas now, read when the dialog opened. */
  read: ReadBack | null;
  onApply: RefineApply;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const call = useAICall<Proposal>("/api/ai/refine-diagram");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { state } = call;
  const proposal = state.status === "complete" ? state.data : null;
  const form = state.status === "idle" || state.status === "failed";

  function ask() {
    const text = instruction.trim();
    if (!text || !read) return;
    call.run({ instruction: text, spec: read.spec });
  }

  function close(next: boolean) {
    if (!next) {
      call.reset();
      setInstruction("");
    }
    onOpenChange(next);
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true);
    try {
      await onApply(proposal);
    } finally {
      setBusy(false);
    }
    close(false);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent
        className="max-h-[90dvh] w-[min(560px,calc(100vw-32px))] max-w-none overflow-y-auto"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textarea.current?.focus();
        }}
      >
        <DialogTitle>Refine with AI</DialogTitle>
        <DialogDescription className="mt-1 type-body-sm text-muted-foreground">
          Say what to change in the diagram. You see a summary first, and nothing on the canvas
          moves until you apply it.
        </DialogDescription>

        {form ? (
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5">
              <span className="type-body-md font-semibold text-foreground">What to change</span>
              <textarea
                ref={textarea}
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    ask();
                  }
                }}
                maxLength={1000}
                rows={3}
                placeholder="For example: add a cache between the order service and the database"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-[16px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-primary md:text-[14px]"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Examples">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setInstruction(example)}
                  className="inline-flex min-h-11 cursor-pointer items-center rounded-md bg-secondary px-3 type-body-sm text-foreground hover:bg-accent md:min-h-8"
                >
                  {example}
                </button>
              ))}
            </div>
            {state.status === "failed" ? (
              <AiFailureNotice
                error={state.error}
                text="Couldn’t refine that. Nothing was changed."
                onRetry={call.retry}
                onDismiss={call.reset}
              />
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button onClick={ask} disabled={!instruction.trim() || !read}>
                Refine
              </Button>
            </div>
          </div>
        ) : null}

        {state.status === "generating" ? (
          <div className="mt-4 flex flex-col gap-4">
            <AiGenerating label="Working out the changes" lines={2} />
            <div className="flex justify-end">
              <Button variant="secondary" onClick={call.reset}>
                Stop
              </Button>
            </div>
          </div>
        ) : null}

        {proposal ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="type-body-md font-semibold text-foreground" data-testid="refine-summary">
              {proposal.summary}
            </p>
            {proposal.ops.length === 0 ? (
              <p className="type-body-sm text-muted-foreground">
                The AI didn’t find a change to make. Try saying it another way.
              </p>
            ) : (
              <p className="type-body-sm text-muted-foreground">
                New parts go into an Additions frame beside the diagram. Nothing else moves.
              </p>
            )}
            {proposal.warnings.length > 0 ? (
              <ul
                role="status"
                aria-label="What was left out"
                className="list-disc space-y-0.5 pl-5 type-body-sm text-muted-foreground"
              >
                {proposal.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => close(false)}>
                Discard
              </Button>
              <Button variant="secondary" onClick={ask}>
                Try again
              </Button>
              <Button onClick={() => void apply()} disabled={busy || proposal.ops.length === 0}>
                Apply
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
