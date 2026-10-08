"use client";

/* eslint-disable react-hooks/refs --
   dnd-kit hands out ref callbacks (`setNodeRef`) and listener objects that the React compiler's
   lint cannot tell apart from reads of a ref during render. They are used exactly as the library
   documents, and only here: every drag source and drop target in views goes through these two
   components, so the exception stays in one file. */

import { useDraggable, useDroppable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DragData } from "./dnd";

/**
 * A card that can be dragged and dropped onto. The whole card takes the mouse and the touch
 * long-press; the keyboard lifts it from its grip button (Space), which is also what a screen
 * reader finds ("Move <title>").
 */
export function DragCard({
  dragId,
  itemId,
  data,
  label,
  className,
  dropTarget = true,
  render,
}: {
  /** Unique among everything draggable (the same card can be in several tag columns). */
  dragId: string;
  /** The item's own id (a hook for tests and for focus). */
  itemId: string;
  data: DragData;
  /** The item's title, for the grip's accessible name. */
  label: string;
  className?: string;
  /** Other cards can be dropped on it (a board column's order). Off where only a day matters. */
  dropTarget?: boolean;
  render: (parts: { handle: React.ReactNode }) => React.ReactNode;
}) {
  const draggable = useDraggable({ id: dragId, data });
  const droppable = useDroppable({ id: `card:${dragId}`, data, disabled: !dropTarget });

  return (
    <li
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      {...draggable.listeners}
      data-item-id={itemId}
      className={cn("touch-manipulation", draggable.isDragging && "opacity-40", className)}
    >
      {render({
        handle: (
          <button
            type="button"
            ref={draggable.setActivatorNodeRef}
            {...draggable.attributes}
            aria-label={`Move ${label}`}
            className="inline-flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground hover:bg-accent focus-visible:bg-accent"
          >
            <GripVertical className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        ),
      })}
    </li>
  );
}

/** A place a card can be dropped (a board column, a calendar day). */
export function DropZone({
  id,
  data,
  disabled,
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  id: string;
  data: DragData;
  disabled?: boolean;
  as?: "div" | "section";
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  const { setNodeRef, isOver } = useDroppable({ id, data, disabled });
  return (
    <Tag ref={setNodeRef} className={cn(className)} data-over={isOver ? "" : undefined} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * One row of the notes tree: dragged by the mouse or a long press, and dropped on. Only the row
 * itself (not the branch beneath it) is the draggable, so "above, onto, below" is measured against
 * the row. `data-drop` carries where the pointer is, for the line or outline the row draws.
 */
export function TreeRowDrag({
  id,
  label,
  disabled,
  dropHint,
  className,
  children,
  ...rest
}: {
  id: string;
  label: string;
  disabled?: boolean;
  dropHint?: "before" | "inside" | "after" | null;
  className?: string;
  children: React.ReactNode;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "className" | "children">) {
  const data: DragData = { type: "treeRow", id, label };
  const draggable = useDraggable({ id, data, disabled });
  const droppable = useDroppable({ id, data });
  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      // The library's listeners only: its `attributes` would give the row a button role.
      {...draggable.listeners}
      data-tree-row={id}
      data-drop={dropHint ?? undefined}
      className={cn(className, draggable.isDragging && "opacity-40")}
      {...rest}
    >
      {children}
    </div>
  );
}

/** The empty space below the tree: a note dropped here goes to the end of the top level. */
export function TreeRootDrop({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: "tree-root",
    data: { type: "treeRow", id: "tree-root", label: "Top level" },
  });
  return (
    <div ref={setNodeRef} className={className} data-over={isOver ? "" : undefined}>
      {children}
    </div>
  );
}
