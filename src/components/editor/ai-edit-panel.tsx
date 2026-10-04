"use client";

import { ArrowDownToLine, Replace } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { AiFailureNotice, AiLabel, StreamCaret } from "@/components/ai/ai-ui";
import { useAIEvents } from "@/components/ai/use-ai";
import {
  insertBelow,
  replaceSelection,
  trackRange,
  type SelectionInfo,
} from "@/components/editor/ai-apply";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { TABLET_UP_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import type { EditMode, StreamEvent } from "@/lib/ai/types";
import { selectionRefusal, SIMPLIFIED, splitParagraphs, STALE } from "@/lib/editor/replace-plan";

type Props = {
  editor: Editor;
  mode: EditMode;
  /** The selection when the person chose the mode. */
  info: SelectionInfo;
  onClose: () => void;
};

const TITLES: Record<EditMode, string> = {
  IMPROVE: "Improve",
  SHORTEN: "Shorten",
  FIX_GRAMMAR: "Fix grammar",
  CONTINUE: "Continue",
};

type Data = { text: string };
const INITIAL: Data = { text: "" };
const reduce = (data: Data, event: StreamEvent): Data =>
  event.type === "text" ? { text: data.text + event.delta } : data;

/** A virtual anchor under the selection, so the panel sits where the text is. */
function useSelectionAnchor(editor: Editor, info: SelectionInfo) {
  return useMemo(
    () => ({
      current: {
        getBoundingClientRect: () => {
          try {
            const start = editor.view.coordsAtPos(info.from);
            const end = editor.view.coordsAtPos(info.to);
            const left = Math.min(start.left, end.left);
            const top = Math.min(start.top, end.top);
            return new DOMRect(
              left,
              top,
              Math.max(1, Math.max(start.right, end.right) - left),
              Math.max(1, Math.max(start.bottom, end.bottom) - top),
            );
          } catch {
            return new DOMRect(0, 0, 0, 0);
          }
        },
      },
    }),
    [editor, info.from, info.to],
  );
}

function PanelBody({ editor, mode, info, onClose }: Props) {
  const ids = useId();
  const { state, run, retry, stop } = useAIEvents("/api/ai/edit-selection", INITIAL, reduce);
  const [stale, setStale] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tracker = useRef<ReturnType<typeof trackRange> | null>(null);

  const continuing = mode === "CONTINUE";
  const refusal = continuing ? null : selectionRefusal(info.blockTypes, info.text);

  // Follow the selected range, and ask the model once when the panel opens (unless refused).
  useEffect(() => {
    const track = trackRange(editor, info);
    tracker.current = track;
    const onTransaction = () => setStale(track.current().stale);
    editor.on("transaction", onTransaction);
    return () => {
      editor.off("transaction", onTransaction);
      track.stop();
      tracker.current = null;
    };
  }, [editor, info]);

  useEffect(() => {
    if (refusal) return;
    run({
      mode,
      text: info.text,
      ...(continuing ? { before: info.before } : {}),
    });
    // Once, when the panel opens: Regenerate and Retry repeat the same request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const streaming = state.status === "generating";
  const text = state.status === "idle" ? "" : state.data.text;
  const usable = splitParagraphs(text).length > 0;
  const done = state.status === "complete" || state.status === "stopped";
  const mixed = info.mixedMarks && !continuing;

  function apply() {
    const range = tracker.current?.current();
    if (!range || range.stale) {
      setStale(true);
      return;
    }
    const result = continuing
      ? insertBelow(editor, range, text)
      : replaceSelection(editor, range, info.text, text);
    if (result.ok) {
      onClose();
      editor.commands.focus();
    } else {
      setProblem(result.reason);
      if (result.reason === STALE) setStale(true);
    }
  }

  return (
    <div
      tabIndex={-1}
      onKeyDown={(event) => {
        // Enter confirms, but only from the panel itself: on a button it must press that button.
        if (event.key === "Enter" && event.target === event.currentTarget && done && usable) {
          event.preventDefault();
          apply();
        }
      }}
      className="flex flex-col gap-3 outline-none"
    >
      <div className="flex items-baseline justify-between gap-3">
        <AiLabel>{streaming ? "Writing…" : "AI-generated"}</AiLabel>
        <p className="type-label-md">{TITLES[mode]}</p>
      </div>

      {refusal ? (
        <p role="alert" className="type-body-md">
          {refusal}
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {continuing ? null : (
              <section aria-labelledby={`${ids}-before`}>
                <h3 id={`${ids}-before`} className="type-label-caps text-muted-foreground">
                  Before
                </h3>
                <p className="mt-1 max-h-48 overflow-y-auto rounded-md bg-background p-3 type-body-md whitespace-pre-wrap">
                  {info.text}
                </p>
              </section>
            )}
            <section
              aria-labelledby={`${ids}-after`}
              aria-busy={streaming}
              className={continuing ? "md:col-span-2" : undefined}
            >
              <h3 id={`${ids}-after`} className="type-label-caps text-muted-foreground">
                {continuing ? "New text" : "After"}
              </h3>
              <p className="mt-1 max-h-48 min-h-12 overflow-y-auto rounded-md bg-background p-3 type-body-md whitespace-pre-wrap">
                {text}
                {streaming ? <StreamCaret /> : null}
              </p>
            </section>
          </div>

          <p role="status" className="sr-only">
            {streaming
              ? "Writing"
              : state.status === "stopped"
                ? "Stopped"
                : done
                  ? "Draft ready"
                  : ""}
          </p>
          {state.status === "stopped" ? (
            <p aria-hidden className="type-body-sm text-muted-foreground">
              Stopped. You can still use what was written.
            </p>
          ) : null}
          {mixed && done ? (
            <p className="type-body-sm text-muted-foreground">{SIMPLIFIED}</p>
          ) : null}
          {stale ? (
            <p role="alert" className="type-body-md text-destructive">
              {STALE}
            </p>
          ) : null}
          {problem && !stale ? (
            <p role="alert" className="type-body-md text-destructive">
              {problem}
            </p>
          ) : null}
          {state.status === "failed" || (state.status === "complete" && !usable) ? (
            <AiFailureNotice
              error={
                state.status === "failed"
                  ? state.error
                  : { code: "AI_PROVIDER_ERROR", message: "Couldn’t edit that text." }
              }
              text="Couldn’t edit that text. Nothing was changed."
              onRetry={() => {
                setProblem(null);
                retry();
              }}
              onDismiss={onClose}
            />
          ) : null}
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2">
        {streaming ? (
          <Button variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : null}
        {!streaming && !refusal ? (
          <Button
            variant="secondary"
            onClick={() => {
              setProblem(null);
              setStale(false);
              retry();
            }}
          >
            Regenerate
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onClose}>
          Discard
        </Button>
        {!refusal ? (
          <Button disabled={!done || !usable || stale} onClick={apply}>
            {continuing ? (
              <ArrowDownToLine strokeWidth={1.5} aria-hidden />
            ) : (
              <Replace strokeWidth={1.5} aria-hidden />
            )}
            {continuing ? "Insert below" : "Replace"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Writing help's preview (feature 08 §7.4): the selected text before, the model's version arriving
 * after, and Replace, Regenerate or Discard. A popover under the selection on wider screens, a
 * bottom sheet on a phone. Nothing in the note changes until Replace or Insert below.
 */
export function AiEditPanel(props: Props) {
  const wide = useMediaQuery(TABLET_UP_QUERY);
  const anchor = useSelectionAnchor(props.editor, props.info);

  if (!wide) {
    return (
      <Sheet open onOpenChange={(open) => !open && props.onClose()}>
        <SheetContent side="bottom" className="gap-3 ai-panel p-4" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Writing help</SheetTitle>
          <SheetDescription className="sr-only">
            Review the suggested text, then replace or discard it.
          </SheetDescription>
          <PanelBody {...props} />
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open onOpenChange={(open) => !open && props.onClose()}>
      <PopoverAnchor virtualRef={anchor} />
      <PopoverContent
        side="bottom"
        align="start"
        aria-label="Writing help"
        onOpenAutoFocus={(event) => {
          // Focus the panel, not a button: Enter then confirms, and nothing is pre-pressed.
          event.preventDefault();
          (event.currentTarget as HTMLElement)
            .querySelector<HTMLElement>("[tabindex='-1']")
            ?.focus();
        }}
        className="w-[min(92vw,640px)] ai-panel p-4"
      >
        <PanelBody {...props} />
      </PopoverContent>
    </Popover>
  );
}
