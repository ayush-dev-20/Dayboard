import { CYCLE_MESSAGE, MAX_NOTE_DEPTH, checkDepth, descendantIds, subtreeHeight } from "./tree";
import type { NoteTreeRow } from "./dto";

// What dragging a note in a tree (or pressing Alt+Up or Alt+Down on it) means (V2 feature 07 §5):
// the new parent and the place among its new siblings. Pure, so the rules (a note can't go into
// itself, nothing deeper than five levels) are tested without a browser; the server checks them
// again, so a stale tree can't break them.

/** Where on a row a drop landed: above it, onto it (becomes its sub-note), or below it. */
export type DropZone = "before" | "inside" | "after";

export type MovePlan =
  | { ok: true; parentId: string | null; beforeId: string | null; afterId: string | null }
  | { ok: false; reason: string };

/** The part of a row's height that counts as "above" and "below"; the middle is "onto it". */
export const EDGE = 0.25;

/** Which zone a pointer at `y` is in, for a row that spans `top` to `top + height`. */
export function zoneAt(y: number, top: number, height: number): DropZone {
  if (height <= 0) return "inside";
  const ratio = (y - top) / height;
  if (ratio < EDGE) return "before";
  if (ratio > 1 - EDGE) return "after";
  return "inside";
}

const bySort = (a: NoteTreeRow, b: NoteTreeRow) => a.sortOrder - b.sortOrder;

function siblingsOf(rows: readonly NoteTreeRow[], parentId: string | null, exceptId: string) {
  return rows.filter((r) => r.parentId === parentId && r.id !== exceptId).sort(bySort);
}

function check(
  rows: readonly NoteTreeRow[],
  id: string,
  parentId: string | null,
): { ok: true } | { ok: false; reason: string } {
  if (parentId !== null && (parentId === id || descendantIds(rows, id).includes(parentId))) {
    return { ok: false, reason: CYCLE_MESSAGE };
  }
  const parent = parentId === null ? null : rows.find((r) => r.id === parentId);
  if (parentId !== null && !parent) return { ok: false, reason: "That note isn't here any more." };
  const fit = checkDepth(parent?.depth ?? 0, subtreeHeight(rows, id));
  return fit.ok ? { ok: true } : { ok: false, reason: fit.reason };
}

/** Dropping `activeId` on `overId` in `zone`. Dropping a note on itself does nothing. */
export function planDrop(
  rows: readonly NoteTreeRow[],
  activeId: string,
  overId: string,
  zone: DropZone,
): MovePlan | null {
  if (activeId === overId) return null;
  const over = rows.find((r) => r.id === overId);
  const active = rows.find((r) => r.id === activeId);
  if (!over || !active) return null;

  if (zone === "inside") {
    const verdict = check(rows, activeId, over.id);
    return verdict.ok
      ? { ok: true, parentId: over.id, beforeId: null, afterId: null }
      : { ok: false, reason: verdict.reason };
  }

  const parentId = over.parentId;
  const verdict = check(rows, activeId, parentId);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const siblings = siblingsOf(rows, parentId, activeId);
  const at = siblings.findIndex((r) => r.id === over.id);
  return zone === "before"
    ? {
        ok: true,
        parentId,
        beforeId: siblings[at - 1]?.id ?? null,
        afterId: over.id,
      }
    : {
        ok: true,
        parentId,
        beforeId: over.id,
        afterId: siblings[at + 1]?.id ?? null,
      };
}

/** Dropping on the empty space below the tree: the end of the top level. */
export function planDropToTop(rows: readonly NoteTreeRow[], activeId: string): MovePlan | null {
  const active = rows.find((r) => r.id === activeId);
  if (!active) return null;
  const verdict = check(rows, activeId, null);
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  const last = siblingsOf(rows, null, activeId).at(-1);
  return { ok: true, parentId: null, beforeId: last?.id ?? null, afterId: null };
}

/** Alt+Up or Alt+Down: one step among the note's own siblings. Null when it is already at the end. */
export function planReorder(
  rows: readonly NoteTreeRow[],
  id: string,
  direction: "up" | "down",
): MovePlan | null {
  const note = rows.find((r) => r.id === id);
  if (!note) return null;
  const siblings = rows.filter((r) => r.parentId === note.parentId).sort(bySort);
  const at = siblings.findIndex((r) => r.id === id);
  if (direction === "up") {
    if (at <= 0) return null;
    // Just above the sibling that is above it now.
    return {
      ok: true,
      parentId: note.parentId,
      beforeId: siblings[at - 2]?.id ?? null,
      afterId: siblings[at - 1]!.id,
    };
  }
  if (at < 0 || at >= siblings.length - 1) return null;
  return {
    ok: true,
    parentId: note.parentId,
    beforeId: siblings[at + 1]!.id,
    afterId: siblings[at + 2]?.id ?? null,
  };
}

/** Whether a new sub-note can go under this note (the "+" on its row). */
export function canAddSubNote(rows: readonly NoteTreeRow[], id: string): boolean {
  const note = rows.find((r) => r.id === id);
  return note !== undefined && note.depth < MAX_NOTE_DEPTH;
}
