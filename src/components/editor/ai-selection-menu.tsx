"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EditMode } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

/** What the menu can start: Writing help's modes, "Update with AI" (`CUSTOM`) and "Ask AI" (feature 11 §6B). */
export type HelpMode = EditMode | "ASK";

const ONE_CLICK: { mode: HelpMode; label: string; hint?: string }[] = [
  { mode: "IMPROVE", label: "Improve" },
  { mode: "SHORTEN", label: "Shorten" },
  { mode: "FIX_GRAMMAR", label: "Fix grammar" },
  { mode: "CONTINUE", label: "Continue", hint: "Uses the text before your cursor." },
];

// After a divider: the two open-ended actions, which ask what you want (feature 11 §6B).
const OPEN_ENDED: { mode: HelpMode; label: string; hint: string }[] = [
  { mode: "ASK", label: "Ask AI…", hint: "Ask a question about the selected text." },
  { mode: "CUSTOM", label: "Update with AI…", hint: "Rewrite the selected text your way." },
];

type Props = {
  editor: Editor;
  /** `bubble` sits in the floating selection menu, `toolbar` in the formatting toolbar. */
  placement: "bubble" | "toolbar";
  onChoose: (mode: HelpMode) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * Writing help (feature 08 §7.2): Improve, Shorten, Fix grammar and Continue. The first three need
 * a selection; Continue works from a cursor. This only chooses; the panel does the rest, and
 * nothing is sent until it opens.
 */
export function WritingHelpMenu({ editor, placement, onChoose, open, onOpenChange }: Props) {
  const hasSelection = useEditorState({
    editor,
    selector: ({ editor: e }) => !e.state.selection.empty,
  });
  const bubble = placement === "bubble";
  // In the floating selection menu, the dropdown is rendered inside that menu. Tiptap removes the
  // floating menu from the page when the editor loses focus, and opening the dropdown moves focus
  // into it; rendered elsewhere, the button it hangs from disappears and it falls to the window's
  // top-left corner. Inside the floating menu, Tiptap counts the focus as still "in the menu".
  const [floatingBar, setFloatingBar] = useState<HTMLElement | null>(null);
  const anchorRef = useCallback(
    (el: HTMLElement | null) => setFloatingBar(bubble ? (el?.parentElement ?? null) : null),
    [bubble],
  );
  // The panel opens only after the menu has finished closing (`onCloseAutoFocus`), never from the
  // item's own `onSelect`: opened while the closing menu still holds focus, the panel counts that
  // as a click outside and dismisses itself at once.
  const chosen = useRef<HelpMode | null>(null);

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger
        ref={anchorRef}
        // Keep the text selection: opening the menu must not move focus out of the editor first.
        onMouseDown={(event) => event.preventDefault()}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-md px-2 type-label-md text-foreground hover:bg-accent",
          bubble ? "h-8" : "h-11 md:h-8",
        )}
      >
        {bubble ? "Improve writing" : "Writing help"}
        <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        container={floatingBar}
        align="start"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const mode = chosen.current;
          chosen.current = null;
          if (mode) onChoose(mode);
        }}
        className="min-w-60 p-1.5"
      >
        {ONE_CLICK.map((item) => (
          <DropdownMenuItem
            key={item.mode}
            disabled={item.mode !== "CONTINUE" && !hasSelection}
            onSelect={() => {
              chosen.current = item.mode;
            }}
            className="flex-col items-start justify-center gap-0.5 px-3 py-2 md:min-h-9"
          >
            {item.label}
            {item.hint ? (
              <span className="type-body-sm text-muted-foreground">{item.hint}</span>
            ) : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        {OPEN_ENDED.map((item) => (
          <DropdownMenuItem
            key={item.mode}
            disabled={!hasSelection}
            onSelect={() => {
              chosen.current = item.mode;
            }}
            className="flex-col items-start justify-center gap-0.5 px-3 py-2 md:min-h-9"
          >
            {item.label}
            <span className="type-body-sm text-muted-foreground">{item.hint}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
