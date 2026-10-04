"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ChevronDown, FilePlus, Replace, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AiFailureNotice, AiLabel, GrowingAiPanel, StreamCaret } from "@/components/ai/ai-ui";
import { DocPreview } from "@/components/ai/doc-preview";
import { useAIEvents } from "@/components/ai/use-ai";
import type { ApplyResult } from "@/components/editor/ai-apply";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { GENERATE_LENGTHS, type GenerateLength, type StreamEvent } from "@/lib/ai/types";
import { convertMarkdown } from "@/lib/editor/markdown";
import { toPlainText } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";
import { GENERATE_PROMPT_MAX } from "@/lib/validations/ai";
import { cn } from "@/lib/utils";

export type GenerateTarget =
  { kind: "new" } | { kind: "note"; id: string } | { kind: "task"; id: string };
export type Placement = "cursor" | "end" | "replace";

export type GenerateResult = {
  doc: TiptapDoc;
  /** The title to use, or null when the person didn't tick "Use this title". */
  title: string | null;
  placement: Placement;
};

type Props = {
  target: GenerateTarget;
  /** The note or task already has saved content that can be sent as context. */
  hasContext: boolean;
  /** Notes only: offer the title, and whether it starts ticked. */
  title: "none" | "off" | "on";
  variant: "compact" | "document";
  /** Put the cursor in the prompt when the panel appears. */
  autoFocus?: boolean;
  /** Runs before a request so the server reads the latest saved text (flush pending saves). */
  beforeGenerate?: () => Promise<void>;
  /** Applies the draft. The panel closes when it succeeds. */
  onApply: (result: GenerateResult) => Promise<ApplyResult>;
  onClose: () => void;
};

type Data = { title: string | null; text: string };
const INITIAL: Data = { title: null, text: "" };

function reduce(data: Data, event: StreamEvent): Data {
  if (event.type === "title") return { ...data, title: event.text };
  if (event.type === "text") return { ...data, text: data.text + event.delta };
  return data;
}

const LENGTH_LABELS: Record<GenerateLength, string> = {
  SHORT: "Short",
  STANDARD: "Standard",
  DETAILED: "Detailed",
};

const checkbox =
  "flex min-h-11 cursor-pointer items-center gap-2 type-body-md md:min-h-8 [&>input]:size-4 [&>input]:accent-primary";

/**
 * Generate with AI (feature 08 §5, §9.1). A prompt becomes Markdown that streams into a preview
 * styled like the editor. Nothing touches the note or task until the person clicks the apply
 * button, and Stop keeps what was written. The panel owns the form and the draft; the host owns the
 * document and does the applying.
 */
export function GeneratePanel({
  target,
  hasContext,
  title: titleMode,
  variant,
  autoFocus,
  beforeGenerate,
  onApply,
  onClose,
}: Props) {
  const ids = useId();
  const { state, run, retry, stop, reset } = useAIEvents(
    "/api/ai/generate-content",
    INITIAL,
    reduce,
  );

  const [prompt, setPrompt] = useState("");
  const [length, setLength] = useState<GenerateLength>("STANDARD");
  const [useContext, setUseContext] = useState(hasContext);
  const [withTitle, setWithTitle] = useState(titleMode === "on");
  const [useTitle, setUseTitle] = useState(true);
  const [titleEdit, setTitleEdit] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement>("end");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);

  // Focus the prompt when the panel opens from a menu or a link, so typing can start at once.
  // After a page change Next focuses the new page's top once it has rendered, so focus again if
  // that took it away.
  useEffect(() => {
    if (!autoFocus) return;
    const focusPrompt = () => root.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
    focusPrompt();
    const later = window.setTimeout(() => {
      if (!root.current?.contains(document.activeElement)) focusPrompt();
    }, 150);
    return () => window.clearTimeout(later);
  }, [autoFocus]);

  const idle = state.status === "idle";
  const generating = state.status === "generating";
  const hasDraft = state.status === "complete" || state.status === "stopped";
  const data = state.status === "idle" ? INITIAL : state.data;
  const noun = target.kind === "task" ? "task" : "note";
  const showTitle = titleMode !== "none" && withTitle;
  const suggested = titleEdit ?? data.title ?? "";
  const converted = useMemo(
    () => convertMarkdown(data.text, { final: !generating }),
    [data.text, generating],
  );
  const empty = converted.doc.content?.length === 0;

  async function generate() {
    const text = prompt.trim();
    if (!text || generating) return;
    setApplyError(null);
    setTitleEdit(null);
    setUseTitle(true);
    if (target.kind !== "new") await beforeGenerate?.();
    run({
      target: target.kind,
      ...(target.kind === "new" ? {} : { targetId: target.id }),
      prompt: text,
      length,
      withTitle: titleMode !== "none" && withTitle,
      useContext: target.kind !== "new" && hasContext && useContext,
    });
  }

  async function apply() {
    if (empty || applying) return;
    setApplying(true);
    setApplyError(null);
    const result = await onApply({
      doc: converted.doc,
      title: showTitle && useTitle && suggested.trim() ? suggested.trim() : null,
      placement: target.kind === "new" ? "end" : placement,
    });
    setApplying(false);
    if (result.ok) onClose();
    else setApplyError(result.reason);
  }

  function copy() {
    void navigator.clipboard
      .writeText(toPlainText(converted.doc))
      .then(() => toast("Copied."))
      .catch(() => toast.error("Couldn’t copy that."));
  }

  const placements: { value: Placement; label: string; button: string }[] =
    target.kind === "task"
      ? [
          { value: "end", label: "At the end", button: "Add to end" },
          { value: "replace", label: "Replace the description", button: "Replace description" },
        ]
      : [
          { value: "cursor", label: "At the cursor", button: "Insert at cursor" },
          { value: "end", label: "At the end", button: "Insert at end" },
          { value: "replace", label: "Replace everything", button: "Replace note" },
        ];
  const chosen = placements.find((p) => p.value === placement) ?? placements[0]!;
  const primaryLabel = target.kind === "new" ? "Create note" : chosen.button;
  const replacing = target.kind !== "new" && placement === "replace";

  const status = generating
    ? "Writing"
    : hasDraft
      ? state.status === "stopped"
        ? "Stopped"
        : "Draft ready"
      : "";

  return (
    <div
      className="mb-4"
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && idle) {
          event.preventDefault();
          void generate();
        } else if (event.key === "Escape") {
          event.stopPropagation();
          if (generating) stop();
          else onClose();
        }
      }}
    >
      <GrowingAiPanel label="Generate with AI" busy={generating}>
        <section ref={root} className="flex flex-col gap-3">
          <AiLabel>{generating ? "Writing…" : "AI-generated"}</AiLabel>

          {idle || state.status === "failed" ? (
            <>
              <div>
                <label htmlFor={`${ids}-prompt`} className="sr-only">
                  What should it write?
                </label>
                <textarea
                  id={`${ids}-prompt`}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={3}
                  maxLength={GENERATE_PROMPT_MAX}
                  placeholder="e.g. A one-page brief for the Acme rebrand"
                  className="block w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-base outline-none focus-visible:border-primary md:text-sm"
                />
              </div>
              <SegmentedControl
                label="Length"
                value={length}
                onValueChange={setLength}
                options={GENERATE_LENGTHS.map((value) => ({ value, label: LENGTH_LABELS[value] }))}
              />
              <div className="flex flex-wrap gap-x-6">
                {target.kind !== "new" && hasContext ? (
                  <label className={checkbox}>
                    <input
                      type="checkbox"
                      checked={useContext}
                      onChange={(e) => setUseContext(e.target.checked)}
                    />
                    Use this {noun} as context
                  </label>
                ) : null}
                {titleMode !== "none" ? (
                  <label className={checkbox}>
                    <input
                      type="checkbox"
                      checked={withTitle}
                      onChange={(e) => setWithTitle(e.target.checked)}
                    />
                    Write the title too
                  </label>
                ) : null}
              </div>
              {state.status === "failed" ? (
                <AiFailureNotice
                  error={state.error}
                  text="Couldn’t write that. Nothing was changed."
                  onRetry={() => {
                    setTitleEdit(null);
                    retry();
                  }}
                  onDismiss={reset}
                />
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
                <Button disabled={!prompt.trim()} onClick={() => void generate()}>
                  <Sparkles strokeWidth={1.5} aria-hidden />
                  Generate
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="type-body-md text-muted-foreground">
                <span className="sr-only">Your prompt: </span>“{prompt.trim()}”
              </p>

              {showTitle && (data.title || titleEdit !== null) ? (
                <div className="flex flex-col gap-1">
                  <label htmlFor={`${ids}-title`} className="type-label-md">
                    Title
                  </label>
                  <input
                    id={`${ids}-title`}
                    value={suggested}
                    maxLength={300}
                    disabled={generating}
                    onChange={(e) => setTitleEdit(e.target.value)}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-base outline-none focus-visible:border-primary md:h-8 md:text-sm"
                  />
                  <label className={checkbox}>
                    <input
                      type="checkbox"
                      checked={useTitle}
                      onChange={(e) => setUseTitle(e.target.checked)}
                    />
                    Use this title
                  </label>
                </div>
              ) : null}

              <div className="relative">
                <DocPreview
                  markdown={data.text}
                  streaming={generating}
                  variant={variant}
                  label="Draft"
                />
                {generating && empty ? <StreamCaret /> : null}
              </div>
              {converted.truncated ? (
                <p className="type-body-sm text-muted-foreground">Shortened to fit.</p>
              ) : null}

              <p role="status" className="sr-only">
                {status}
              </p>
              {generating ? (
                <p aria-hidden className="type-body-sm text-muted-foreground">
                  Writing…
                </p>
              ) : null}
              {state.status === "stopped" ? (
                <p aria-hidden className="type-body-sm text-muted-foreground">
                  Stopped. You can still use what was written.
                </p>
              ) : null}

              {replacing ? (
                <p className="type-body-md">
                  {target.kind === "task"
                    ? "This replaces the whole description."
                    : "This replaces the whole note. You can undo with ⌘Z."}
                </p>
              ) : null}
              {applyError ? (
                <p role="alert" className="type-body-md text-destructive">
                  {applyError}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-2">
                {generating ? (
                  <Button variant="secondary" onClick={stop}>
                    Stop
                  </Button>
                ) : (
                  <>
                    <Button variant="ghost" onClick={onClose}>
                      Discard
                    </Button>
                    <Button variant="ghost" onClick={copy} disabled={empty}>
                      Copy
                    </Button>
                    <Button variant="ghost" onClick={reset}>
                      Edit prompt
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setApplyError(null);
                        setTitleEdit(null);
                        retry();
                      }}
                    >
                      Regenerate
                    </Button>
                    <div className="flex">
                      <Button
                        disabled={empty || applying}
                        onClick={() => void apply()}
                        className={cn(target.kind !== "new" && "rounded-r-none")}
                      >
                        {target.kind === "new" ? (
                          <FilePlus strokeWidth={1.5} aria-hidden />
                        ) : placement === "replace" ? (
                          <Replace strokeWidth={1.5} aria-hidden />
                        ) : (
                          <ArrowDownToLine strokeWidth={1.5} aria-hidden />
                        )}
                        {primaryLabel}
                      </Button>
                      {target.kind !== "new" ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            aria-label="Where to put it"
                            className="inline-flex h-11 items-center rounded-r-md border-l border-primary-foreground/30 bg-primary px-2 text-primary-foreground hover:bg-primary-strong md:h-8"
                          >
                            <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuRadioGroup
                              value={placement}
                              onValueChange={(v) => setPlacement(v as Placement)}
                            >
                              {placements.map((p) => (
                                <DropdownMenuRadioItem key={p.value} value={p.value}>
                                  {p.label}
                                </DropdownMenuRadioItem>
                              ))}
                            </DropdownMenuRadioGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </section>
      </GrowingAiPanel>
    </div>
  );
}
