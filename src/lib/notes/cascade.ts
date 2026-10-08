// Which notes a Trash or archive action takes along, and which a restore brings back (V2 feature
// 07 §2). Pure: the server loads the subtree of the note being acted on and asks these functions
// which rows to change, so the rules can be tested without a database.
//
// Every note that goes to Trash (or is archived) by one action on a parent gets the same cascade id.
// Restoring brings back exactly the rows carrying that id, so a sub-note that was already in Trash
// for its own reasons stays there.

export type CascadeRow = {
  id: string;
  parentId: string | null;
  deletedAt: Date | string | null;
  deletedCascadeId: string | null;
  archivedAt: Date | string | null;
  archivedCascadeId: string | null;
};

type Kind = "deleted" | "archived";

const stateOf = (row: CascadeRow, kind: Kind) =>
  kind === "deleted"
    ? { at: row.deletedAt, cascade: row.deletedCascadeId }
    : { at: row.archivedAt, cascade: row.archivedCascadeId };

function childrenIndex(rows: readonly CascadeRow[]) {
  const index = new Map<string, CascadeRow[]>();
  for (const row of rows) {
    if (row.parentId === null) continue;
    index.set(row.parentId, [...(index.get(row.parentId) ?? []), row]);
  }
  return index;
}

/** The note and every note below it, at any depth. */
export function subtreeRows(rows: readonly CascadeRow[], rootId: string): CascadeRow[] {
  const root = rows.find((r) => r.id === rootId);
  if (!root) return [];
  const index = childrenIndex(rows);
  const out: CascadeRow[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next.id)) continue;
    seen.add(next.id);
    out.push(next);
    queue.push(...(index.get(next.id) ?? []));
  }
  return out;
}

/**
 * Moving a parent to Trash (or archiving it) takes the note itself and every sub-note, at any depth,
 * that is not already in that state. A sub-note that is already in Trash keeps its own earlier
 * state and its own cascade id.
 */
export function cascadeSet(rows: readonly CascadeRow[], rootId: string, kind: Kind): string[] {
  return subtreeRows(rows, rootId)
    .filter((row) => {
      if (row.id === rootId) return true;
      // A note that is in Trash is not archived or restored by something done to its parent.
      if (kind === "archived" && row.deletedAt !== null) return false;
      return stateOf(row, kind).at === null;
    })
    .map((row) => row.id);
}

/**
 * Restoring (or unarchiving) a note brings back exactly the notes that went with it: the note
 * itself and the sub-notes carrying its cascade id, reached through other such notes. A note
 * without a cascade id (one trashed before sub-notes existed, or on its own) restores alone.
 */
export function restoreSet(rows: readonly CascadeRow[], rootId: string, kind: Kind): string[] {
  const root = rows.find((r) => r.id === rootId);
  if (!root) return [];
  const { cascade } = stateOf(root, kind);
  if (cascade === null) return [rootId];
  const index = childrenIndex(rows);
  const out: string[] = [];
  const queue = [root];
  while (queue.length > 0) {
    const next = queue.shift()!;
    out.push(next.id);
    for (const child of index.get(next.id) ?? []) {
      const state = stateOf(child, kind);
      if (state.at !== null && state.cascade === cascade) queue.push(child);
    }
  }
  return out;
}

/** "Includes 3 sub-notes" in Trash and in the confirm dialogs. */
export function subNoteCount(set: readonly string[]): number {
  return Math.max(0, set.length - 1);
}

export function subNotesWord(count: number): string {
  return `${count} ${count === 1 ? "sub-note" : "sub-notes"}`;
}

/**
 * A sub-note cannot come back inside a parent that is still in Trash (or archived): it comes back
 * as a top-level note, after the person agrees. `at` is the parent's `deletedAt` (or `archivedAt`);
 * `null` for a note with no parent.
 */
export function needsTopLevel(parent: { at: Date | string | null } | null): boolean {
  return parent !== null && parent.at !== null;
}
