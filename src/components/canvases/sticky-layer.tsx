"use client";

import { useMemo } from "react";
import { Check, Copy, ExternalLink, Trash2, X } from "lucide-react";
import { DatePicker } from "@/components/tasks/task-properties";
import { COLOR_TOKENS, type ColorToken } from "@/lib/colors";
import { formatDay } from "@/lib/dates/calendar";
import type { StickyInfoDTO } from "@/lib/canvas/dto";
import {
  STICKY_COLORS,
  STICKY_COLOR_NAMES,
  readStickies,
  type StickyNote,
  type StickyShape,
} from "@/lib/canvas/sticky";
import type { SceneElement } from "@/lib/canvas/types";
import { cn } from "@/lib/utils";
import type { CanvasFrame } from "./excalidraw-inner";
import { shapeOf } from "./sticky-tools";

// Everything drawn over the drawing for sticky notes (V3 feature 01 §13.5): a checkbox and a due chip on each note, and a
// small toolbar above the selected note or notes. They are real buttons laid over the canvas that follow pan and zoom;
// the drawing itself holds only the note, so they are never in an exported PNG or SVG.

export type StickyActions = {
  complete: (id: string, done: boolean) => void;
  setDue: (id: string, due: { date: string | null; time: string | null }) => void;
  details: (id: string) => void;
  recolour: (elementIds: string[], tone: ColorToken) => void;
  reshape: (elementIds: string[], shape: StickyShape) => void;
  duplicate: () => void;
  remove: () => void;
};

/** Notes smaller than this on screen get no badge: it would cover them. */
const MIN_BADGE_WIDTH = 64;

function screen(frame: CanvasFrame, note: StickyNote) {
  return {
    left: (note.x + frame.scrollX) * frame.zoom,
    top: (note.y + frame.scrollY) * frame.zoom,
    width: note.width * frame.zoom,
    height: note.height * frame.zoom,
  };
}

function Badge({
  note,
  info,
  frame,
  today,
  actions,
}: {
  note: StickyNote;
  info: StickyInfoDTO | undefined;
  frame: CanvasFrame;
  today: string;
  actions: StickyActions;
}) {
  const box = screen(frame, note);
  if (!info || box.width < MIN_BADGE_WIDTH) return null;
  if (box.left + box.width < -20 || box.top + box.height < -20) return null;
  if (box.left > frame.width + 20 || box.top > frame.height + 20) return null;
  const done = info.status === "DONE";
  const cancelled = info.status === "CANCELLED";
  const overdue = info.dueDate !== null && info.dueDate < today && !done && !cancelled;
  const title = info.title === "Untitled sticky" ? "sticky note" : info.title;
  return (
    <div
      data-sticky-badge={note.id}
      className="pointer-events-auto absolute flex items-center gap-1"
      style={{ left: box.left + 4, top: box.top + 4 }}
    >
      {cancelled ? (
        <span
          role="img"
          aria-label="Cancelled"
          className="inline-flex size-6 items-center justify-center rounded-sm bg-background/85 text-muted-foreground"
        >
          <X className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
      ) : (
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          aria-label={`Complete ${title}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => actions.complete(note.id, !done)}
          className="inline-flex size-6 cursor-pointer items-center justify-center rounded-sm"
        >
          <span
            className={cn(
              "flex size-[18px] items-center justify-center rounded-sm border",
              done
                ? "border-primary bg-primary text-primary-foreground"
                : "border-foreground/50 bg-background/85",
            )}
          >
            {done ? <Check className="size-3.5" strokeWidth={2.5} aria-hidden /> : null}
          </span>
        </button>
      )}
      {info.dueDate ? (
        <span
          className={cn(
            "rounded-sm bg-background/85 px-1.5 py-0.5 type-data-sm",
            overdue ? "font-semibold text-destructive" : "text-foreground",
          )}
        >
          {overdue ? "Overdue, " : ""}
          {formatDay(info.dueDate, today)}
        </span>
      ) : null}
    </div>
  );
}

function Toolbar({
  frame,
  selected,
  infos,
  actions,
}: {
  frame: CanvasFrame;
  selected: StickyNote[];
  infos: ReadonlyMap<string, StickyInfoDTO>;
  actions: StickyActions;
}) {
  const boxes = selected.map((n) => screen(frame, n));
  const left = Math.min(...boxes.map((b) => b.left));
  const right = Math.max(...boxes.map((b) => b.left + b.width));
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.top + b.height));
  const centre = Math.min(Math.max((left + right) / 2, 230), Math.max(230, frame.width - 230));
  const above = top > 64;
  const ids = selected.map((n) => n.elementId);
  const single = selected.length === 1 ? selected[0]! : null;
  const info = single ? infos.get(single.id) : undefined;
  const tone = selected.every((n) => n.tone === selected[0]!.tone) ? selected[0]!.tone : null;
  const shape = selected.every((n) => shapeOf(n) === shapeOf(selected[0]!))
    ? shapeOf(selected[0]!)
    : null;

  return (
    <div
      role="toolbar"
      aria-label={selected.length === 1 ? "Sticky note" : `${selected.length} sticky notes`}
      data-sticky-toolbar
      onPointerDown={(e) => e.stopPropagation()}
      className="pointer-events-auto absolute flex -translate-x-1/2 items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-md"
      style={{ left: centre, top: above ? top - 52 : bottom + 8 }}
    >
      <div role="group" aria-label="Colour" className="flex items-center">
        {COLOR_TOKENS.map((token) => (
          <button
            key={token}
            type="button"
            aria-label={STICKY_COLOR_NAMES[token]}
            aria-pressed={tone === token}
            title={STICKY_COLOR_NAMES[token]}
            onClick={() => actions.recolour(ids, token)}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent md:size-7"
          >
            <span
              aria-hidden
              style={{ backgroundColor: STICKY_COLORS[token] }}
              className={cn(
                "inline-flex size-[18px] items-center justify-center rounded-full border border-foreground/20",
                tone === token && "ring-2 ring-primary ring-offset-1 ring-offset-popover",
              )}
            >
              {tone === token ? <Check className="size-3" strokeWidth={2.5} /> : null}
            </span>
          </button>
        ))}
      </div>
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <button
        type="button"
        aria-label={shape === "wide" ? "Make square" : "Make rectangular"}
        aria-pressed={shape === "wide"}
        title={shape === "wide" ? "Make square" : "Make rectangular"}
        onClick={() => actions.reshape(ids, shape === "wide" ? "square" : "wide")}
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent md:size-7"
      >
        <span
          aria-hidden
          className={cn(
            "block rounded-[2px] border-2 border-foreground/70",
            shape === "wide" ? "h-3 w-[18px]" : "size-[14px]",
          )}
        />
      </button>
      {single && info ? (
        <>
          <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
          <DatePicker
            label="Due"
            date={info.dueDate}
            time={info.dueTime}
            onChange={(due) => actions.setDue(single.id, due)}
          />
          <button
            type="button"
            aria-label="Details"
            title="Details"
            onClick={() => actions.details(single.id)}
            className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent md:size-7"
          >
            <ExternalLink className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </>
      ) : null}
      <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
      <button
        type="button"
        aria-label="Duplicate"
        title="Duplicate"
        onClick={actions.duplicate}
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md hover:bg-accent md:size-7"
      >
        <Copy className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
      <button
        type="button"
        aria-label="Delete"
        title="Delete"
        onClick={actions.remove}
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-md text-destructive hover:bg-accent md:size-7"
      >
        <Trash2 className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

/** The layer itself: lay it over the drawing's container (it takes no pointer events except on its own buttons). */
export function StickyLayer({
  frame,
  infos,
  today,
  actions,
}: {
  frame: CanvasFrame | null;
  infos: ReadonlyMap<string, StickyInfoDTO>;
  today: string;
  actions: StickyActions;
}) {
  const notes = useMemo(
    () => (frame ? readStickies(frame.elements as unknown as SceneElement[]) : []),
    [frame?.elements], // eslint-disable-line react-hooks/exhaustive-deps
  );
  if (!frame || notes.length === 0) return null;
  const selected = notes.filter((n) => frame.selectedElementIds[n.elementId]);
  // The toolbar is for notes alone: nothing else is selected with them, and nothing is being dragged or typed.
  // (A drag box can select a note's words as well as the note: those count as the note.)
  const noteIds = new Set(notes.map((n) => n.elementId));
  const wordsOfNotes = new Set(
    frame.elements
      .filter(
        (e) => e.type === "text" && typeof e.containerId === "string" && noteIds.has(e.containerId),
      )
      .map((e) => e.id as string),
  );
  const onlyNotes =
    selected.length > 0 &&
    Object.keys(frame.selectedElementIds).every((id) => noteIds.has(id) || wordsOfNotes.has(id));
  const showToolbar = onlyNotes && !frame.moving && frame.editingTextId === null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden">
      {notes.map((note) => (
        <Badge
          key={note.elementId}
          note={note}
          info={infos.get(note.id)}
          frame={frame}
          today={today}
          actions={actions}
        />
      ))}
      {showToolbar ? (
        <Toolbar frame={frame} selected={selected} infos={infos} actions={actions} />
      ) : null}
    </div>
  );
}
