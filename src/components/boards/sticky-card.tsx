"use client";

import { useRef, useState } from "react";
import { Check, Ellipsis, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DragCard } from "@/components/views/dnd-nodes";
import { tintStyle } from "@/components/workspace/tokens";
import { BOARD_LIMITS, type Column } from "@/lib/canvas/board";
import type { StickyDTO } from "@/lib/canvas/dto";
import { formatDay } from "@/lib/dates/calendar";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";
import { TonePicker } from "./tone-picker";

// One sticky note on a board (V3 feature 01 §13.5): a tinted card showing its text. Click or Enter edits it in place and
// saves on blur; its menu has Colour, Move to, Move up and down, Details, Duplicate, Make it a regular task and Delete.
// Completed and Cancelled are told apart without colour: a check or a cross, muted text, and a struck-through title.

export type StickyActions = {
  edit: (id: string, text: string) => Promise<boolean>;
  tone: (id: string, tone: StickyDTO["tone"]) => void;
  moveTo: (id: string, columnId: string) => void;
  moveBy: (id: string, direction: -1 | 1) => void;
  details: (id: string) => void;
  duplicate: (id: string) => void;
  makeTask: (id: string) => void;
  remove: (id: string) => void;
};

export function StickyCard({
  sticky,
  column,
  columns,
  index,
  count,
  today,
  actions,
}: {
  sticky: StickyDTO;
  column: Column;
  columns: Column[];
  index: number;
  count: number;
  today: string;
  actions: StickyActions;
}) {
  const [editing, setEditing] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const draft = useRef<HTMLTextAreaElement>(null);
  const done = sticky.status === "DONE";
  const cancelled = sticky.status === "CANCELLED";
  const [firstLine] = sticky.text.split("\n");

  async function commit() {
    const text = draft.current?.value.trim() ?? "";
    setEditing(false);
    if (!text || text === sticky.text) return;
    await actions.edit(sticky.id, text);
  }

  const overdue = sticky.dueDate !== null && sticky.dueDate < today && !done && !cancelled;

  return (
    <DragCard
      dragId={`sticky|${sticky.id}`}
      itemId={sticky.id}
      label={firstLine ?? "sticky note"}
      data={{
        type: "card",
        id: sticky.id,
        label: firstLine ?? "sticky note",
        columnKey: column.id,
        index,
        count,
        columnLabel: column.name,
      }}
      className="relative"
      render={({ handle }) => (
        <div
          style={tintStyle(sticky.tone)}
          className={cn(
            "rounded-md border px-2.5 py-2",
            sticky.tone ? "tint-surface" : "border-border bg-card",
            (done || cancelled) && "text-muted-foreground",
          )}
        >
          <div className="flex items-start gap-1.5">
            {done ? (
              <Check
                className="mt-[3px] size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-label="Completed"
                role="img"
              />
            ) : cancelled ? (
              <X
                className="mt-[3px] size-4 shrink-0 text-muted-foreground"
                strokeWidth={1.75}
                aria-label="Cancelled"
                role="img"
              />
            ) : null}
            {editing ? (
              <textarea
                ref={draft}
                autoFocus
                defaultValue={sticky.text}
                maxLength={BOARD_LIMITS.stickyText}
                aria-label="Sticky note text"
                rows={Math.min(8, Math.max(2, sticky.text.split("\n").length + 1))}
                onFocus={(e) =>
                  e.currentTarget.setSelectionRange(
                    e.currentTarget.value.length,
                    e.currentTarget.value.length,
                  )
                }
                onBlur={() => void commit()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setEditing(false);
                  } else if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 resize-none rounded-sm border border-input bg-background px-1.5 py-1 text-[16px] text-foreground outline-none focus-visible:border-primary md:text-[14px]"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={`Edit sticky note: ${firstLine}`}
                className={cn(
                  "min-w-0 flex-1 cursor-text text-left type-body-md break-words whitespace-pre-wrap",
                  cancelled && "line-through",
                )}
              >
                {sticky.text}
              </button>
            )}
            {editing ? null : handle}
            {editing ? null : (
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Options for ${firstLine}`}
                  className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-8"
                >
                  <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-52">
                  <DropdownMenuItem onSelect={() => setTimeout(() => setToneOpen(true), 0)}>
                    Colour
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.details(sticky.id)}>
                    Details
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="type-label-caps text-muted-foreground">
                    Move to
                  </DropdownMenuLabel>
                  {columns
                    .filter((c) => c.id !== column.id)
                    .map((c) => (
                      <DropdownMenuItem key={c.id} onSelect={() => actions.moveTo(sticky.id, c.id)}>
                        {c.name}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => actions.moveBy(sticky.id, -1)}
                  >
                    Move up
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index >= count - 1}
                    onSelect={() => actions.moveBy(sticky.id, 1)}
                  >
                    Move down
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => actions.duplicate(sticky.id)}>
                    Duplicate
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => actions.makeTask(sticky.id)}>
                    Make it a regular task
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive data-[highlighted]:text-destructive"
                    onSelect={() => actions.remove(sticky.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {sticky.dueDate || sticky.status !== column.status ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 type-body-sm text-muted-foreground">
              {sticky.dueDate ? (
                <span className={cn(overdue && "text-destructive")}>
                  {overdue ? "Overdue, " : "Due "}
                  {formatDay(sticky.dueDate, today)}
                </span>
              ) : null}
              {sticky.status !== column.status ? <span>{STATUS_LABELS[sticky.status]}</span> : null}
            </p>
          ) : null}
          <TonePicker
            open={toneOpen}
            onOpenChange={setToneOpen}
            value={sticky.tone}
            onChange={(tone) => {
              actions.tone(sticky.id, tone);
              setToneOpen(false);
            }}
            label="Colour of the sticky note"
            align="end"
          >
            <span aria-hidden className="absolute top-2 right-2 size-0" />
          </TonePicker>
        </div>
      )}
    />
  );
}
