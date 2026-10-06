"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import type { Editor } from "@tiptap/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  deleteBlock,
  duplicateBlock,
  moveBlock,
  startBlockDrag,
  topBlockAt,
  turnInto,
  turnIntoOptions,
  type TurnIntoKind,
} from "./commands";

const TURN_INTO_LABELS: Record<TurnIntoKind, string> = {
  text: "Text",
  h1: "Heading 1",
  h2: "Heading 2",
  h3: "Heading 3",
  bullet: "Bulleted list",
  ordered: "Numbered list",
  task: "Checklist",
  quote: "Quote",
  code: "Code",
  callout: "Callout",
  toggle: "Toggle",
  "toggle-h1": "Toggle heading 1",
  "toggle-h2": "Toggle heading 2",
  "toggle-h3": "Toggle heading 3",
};

type Place = { pos: number; top: number; left: number };

/** Where the handle goes for the block that holds `docPos`. */
function placeFor(
  editor: Editor,
  root: HTMLElement,
  docPos: number,
  narrow: boolean,
): Place | null {
  const block = topBlockAt(editor.state.doc, docPos);
  if (!block) return null;
  const dom = editor.view.nodeDOM(block.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  const box = root.getBoundingClientRect();
  return {
    pos: block.pos,
    top: rect.top - box.top + 2,
    // A gutter on the left from tablet width; on a phone there is none, so the handle sits at the
    // block's right edge.
    left: narrow ? rect.right - box.left - 32 : rect.left - box.left - 34,
  };
}

/**
 * A handle beside each block (V2 feature 01 §4): Turn into, Duplicate, Move, Delete, and drag to
 * reorder. It follows the pointer on desktop and sits on the block with the cursor otherwise, so
 * keyboard and touch can reach it too (Tab from the editor moves onto it; Alt+Up and Alt+Down move
 * the block without it).
 */
export function BlockHandle({ editor, root }: { editor: Editor; root: HTMLElement | null }) {
  const [hover, setHover] = useState<Place | null>(null);
  const [active, setActive] = useState<Place | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [message, setMessage] = useState("");
  const frame = useRef(0);

  const narrow = () => window.matchMedia("(max-width: 767px)").matches;

  // The block with the cursor: kept in step with the selection.
  const track = useCallback(() => {
    if (!root || !editor.isFocused) return;
    setActive(placeFor(editor, root, editor.state.selection.from, narrow()));
  }, [editor, root]);

  useEffect(() => {
    editor.on("selectionUpdate", track);
    editor.on("focus", track);
    editor.on("update", track);
    return () => {
      editor.off("selectionUpdate", track);
      editor.off("focus", track);
      editor.off("update", track);
    };
  }, [editor, track]);

  useEffect(() => {
    if (!root) return;
    const onMove = (event: MouseEvent) => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const content = editor.view.dom.getBoundingClientRect();
        // Aim at the text column even when the pointer is over the gutter.
        const at = editor.view.posAtCoords({
          left: Math.min(Math.max(event.clientX, content.left + 24), content.right - 24),
          top: event.clientY,
        });
        setHover(at ? placeFor(editor, root, at.pos, narrow()) : null);
      });
    };
    const onLeave = () => setHover(null);
    root.addEventListener("mousemove", onMove);
    root.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(frame.current);
      root.removeEventListener("mousemove", onMove);
      root.removeEventListener("mouseleave", onLeave);
    };
  }, [editor, root]);

  const place = hover ?? active;
  if (!root || !place || !editor.isEditable) return null;

  const block = topBlockAt(editor.state.doc, place.pos + 1);
  const options = block ? turnIntoOptions(block.node) : [];

  const announce = (text: string) => setMessage(text);
  const move = (direction: -1 | 1) => {
    if (moveBlock(editor, direction, place.pos)) {
      announce(direction === -1 ? "Moved up" : "Moved down");
    }
  };

  return (
    <>
      <div
        className="absolute z-20"
        style={{ top: place.top, left: place.left }}
        data-block-handle=""
      >
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
          <DropdownMenuTrigger
            aria-label="Block options"
            draggable
            onDragStart={(event) => {
              startBlockDrag(editor, place.pos, event.nativeEvent);
              announce("Dragging block");
            }}
            className={cn(
              "inline-flex size-7 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors duration-[120ms] hover:bg-accent hover:text-foreground",
              "pointer-coarse:size-11",
            )}
          >
            <GripVertical className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            collisionPadding={8}
            className="max-h-[min(var(--radix-dropdown-menu-content-available-height),28rem)] overflow-y-auto"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              editor.commands.focus();
            }}
          >
            {options.length > 0 ? (
              <>
                <DropdownMenuLabel className="type-label-caps text-muted-foreground">
                  Turn into
                </DropdownMenuLabel>
                {options.map((kind) => (
                  <DropdownMenuItem key={kind} onSelect={() => turnInto(editor, place.pos, kind)}>
                    {TURN_INTO_LABELS[kind]}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => duplicateBlock(editor, place.pos)}>
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!block || block.index === 0} onSelect={() => move(-1)}>
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!block || block.index >= block.parent.childCount - 1}
              onSelect={() => move(1)}
            >
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => deleteBlock(editor, place.pos)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p role="status" className="sr-only">
        {message}
      </p>
    </>
  );
}
