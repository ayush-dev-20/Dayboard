"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DropZone } from "@/components/views/dnd-nodes";
import { ColorDot, tintStyle } from "@/components/workspace/tokens";
import { BOARD_LIMITS, COLUMN_STATUSES, type Column, type ColumnStatus } from "@/lib/canvas/board";
import type { StickyDTO } from "@/lib/canvas/dto";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";
import { AddSticky } from "./add-sticky";
import { StickyCard, type StickyActions } from "./sticky-card";
import { TonePicker } from "./tone-picker";

// One column of a sticky board (V3 feature 01 §13.5): a header with its name, a count, what it stands for in words and a
// menu (Rename, Colour, Status, Collapse, Move left or right, Delete column), the stickies, and Add sticky note at the foot.

export type ColumnActions = {
  rename: (id: string, name: string) => boolean;
  tone: (id: string, tone: Column["tone"]) => void;
  collapse: (id: string) => void;
  move: (id: string, direction: -1 | 1) => void;
  /** Asks first (the board page shows "3 sticky notes will become Waiting"). */
  status: (column: Column, status: ColumnStatus) => void;
  remove: (column: Column) => void;
};

export function BoardColumn({
  column,
  columns,
  position,
  stickies,
  today,
  isOver,
  phone,
  columnActions,
  stickyActions,
  onAdd,
}: {
  column: Column;
  columns: Column[];
  position: number;
  stickies: StickyDTO[];
  today: string;
  isOver: boolean;
  phone: boolean;
  columnActions: ColumnActions;
  stickyActions: StickyActions;
  onAdd: (text: string) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);
  const headingId = `column-${column.id}`;
  const collapsed = !phone && column.collapsed === true;
  const data = {
    type: "column" as const,
    key: column.id,
    label: column.name,
    count: stickies.length,
  };
  const surface = cn(
    "flex shrink-0 flex-col rounded-lg border",
    isOver
      ? "border-primary bg-primary-subtle"
      : column.tone
        ? "tint-surface"
        : "border-border bg-secondary/40",
  );

  if (collapsed) {
    return (
      <DropZone
        as="section"
        id={`col:${column.id}`}
        data={data}
        aria-labelledby={headingId}
        style={isOver ? undefined : tintStyle(column.tone)}
        className={cn(surface, "w-12 items-center gap-2 py-3")}
      >
        <button
          type="button"
          aria-expanded={false}
          aria-label={`Expand ${column.name}`}
          onClick={() => columnActions.collapse(column.id)}
          className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="size-4" strokeWidth={1.5} aria-hidden />
        </button>
        <h2
          id={headingId}
          className="type-label-caps text-muted-foreground [writing-mode:vertical-rl]"
        >
          {column.name}
        </h2>
        <span className="type-data-sm text-muted-foreground">{stickies.length}</span>
      </DropZone>
    );
  }

  return (
    <DropZone
      as="section"
      id={`col:${column.id}`}
      data={data}
      aria-labelledby={headingId}
      style={isOver ? undefined : tintStyle(column.tone)}
      className={cn(surface, phone ? "w-full" : "w-72 min-w-[260px]")}
    >
      <header className="flex items-center gap-1 px-3 pt-3 pb-2">
        <TonePicker
          open={toneOpen}
          onOpenChange={setToneOpen}
          value={column.tone}
          onChange={(tone) => {
            columnActions.tone(column.id, tone);
            setToneOpen(false);
          }}
          label={`Colour of ${column.name}`}
        >
          <button
            type="button"
            aria-label={`Colour of ${column.name}`}
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-md hover:bg-accent md:size-7"
          >
            <ColorDot
              color={column.tone}
              className={cn(!column.tone && "bg-muted-foreground/40")}
            />
          </button>
        </TonePicker>
        {renaming ? (
          <input
            autoFocus
            defaultValue={column.name}
            maxLength={BOARD_LIMITS.columnName}
            aria-label="Column name"
            onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => {
              columnActions.rename(column.id, e.currentTarget.value);
              setRenaming(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                e.currentTarget.value = column.name;
                e.currentTarget.blur();
              }
            }}
            className="h-8 min-w-0 flex-1 rounded-sm border border-input bg-background px-1.5 type-label-md outline-none focus-visible:border-primary"
          />
        ) : (
          <h2 id={headingId} className="min-w-0 flex-1 truncate type-label-md">
            {column.name}
          </h2>
        )}
        <span className="type-data-sm text-muted-foreground">
          <span className="sr-only">
            {stickies.length === 1 ? "1 sticky note" : `${stickies.length} sticky notes`}
          </span>
          <span aria-hidden>{stickies.length}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Column options for ${column.name}`}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-7"
          >
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={() => setTimeout(() => setRenaming(true), 0)}>
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTimeout(() => setToneOpen(true), 0)}>
              Colour
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="type-label-caps text-muted-foreground">
              Status
            </DropdownMenuLabel>
            {COLUMN_STATUSES.map((status) => (
              <DropdownMenuItem key={status} onSelect={() => columnActions.status(column, status)}>
                {STATUS_LABELS[status]}
                {status === column.status ? (
                  <Check className="ml-auto" strokeWidth={1.5} aria-label="Current status" />
                ) : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            {phone ? null : (
              <DropdownMenuItem onSelect={() => columnActions.collapse(column.id)}>
                Collapse
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={position === 0}
              onSelect={() => columnActions.move(column.id, -1)}
            >
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={position >= columns.length - 1}
              onSelect={() => columnActions.move(column.id, 1)}
            >
              Move right
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={columns.length <= 1}
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => columnActions.remove(column)}
            >
              Delete column
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {phone ? null : (
          <button
            type="button"
            aria-expanded
            aria-label={`Collapse ${column.name}`}
            onClick={() => columnActions.collapse(column.id)}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent md:size-7"
          >
            <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        )}
      </header>
      <p className="px-3 pb-1 type-body-sm text-muted-foreground">
        Status: {STATUS_LABELS[column.status]}
      </p>
      <ul className="flex min-h-12 flex-col gap-2 px-2 pb-2" aria-label={column.name}>
        {stickies.map((sticky, index) => (
          <StickyCard
            key={sticky.id}
            sticky={sticky}
            column={column}
            columns={columns}
            index={index}
            count={stickies.length}
            today={today}
            actions={stickyActions}
          />
        ))}
        {stickies.length === 0 ? (
          <li className="px-1 py-2 type-body-sm text-muted-foreground">No sticky notes</li>
        ) : null}
      </ul>
      <AddSticky columnName={column.name} onAdd={onAdd} />
    </DropZone>
  );
}
