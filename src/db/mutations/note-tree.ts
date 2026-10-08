import "server-only";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Executor, type Tx } from "@/db/executor";
import { notes } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import {
  cascadeSet,
  needsTopLevel,
  restoreSet,
  subNoteCount,
  type CascadeRow,
} from "@/lib/notes/cascade";
import {
  CYCLE_MESSAGE,
  DEPTH_MESSAGE,
  canHaveSubNote,
  checkDepth,
  siblingOrder,
} from "@/lib/notes/tree";
import { orderAtTop, renumber } from "@/lib/tasks/ordering";
import type { TiptapDoc } from "@/lib/editor/types";

// Everything that changes where a note sits, or takes a note's sub-notes along with it (V2 feature
// 07 §2, §3). The rules themselves (depth, cycles, which notes a Trash or archive reaches) are pure
// functions in `src/lib/notes/`; this file loads the part of the tree they need, applies the result
// and keeps `depth` and the cascade ids in step, all inside one transaction.
//
// Hierarchy changes take a lock per person first. Two devices moving notes into each other would
// otherwise each see the other's note where it used to be, and together make a loop.

/** The marker the UI looks for to ask "Restore as a top-level note?". */
export const TOP_LEVEL_FIELD = "parent";
export const TOP_LEVEL_VALUE = "top-level";

const EMPTY_DOC: TiptapDoc = { type: "doc", content: [] };

export async function lockTree(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${userId}, 7))`);
}

export type SubtreeRow = CascadeRow & { depth: number };

type RawRow = {
  id: string;
  parent_note_id: string | null;
  depth: number;
  deleted_at: Date | null;
  deleted_cascade_id: string | null;
  archived_at: Date | null;
  archived_cascade_id: string | null;
};

/** The note and everything below it, in every state (live, archived and in Trash). */
export async function loadSubtree(
  executor: Executor,
  userId: string,
  rootId: string,
): Promise<SubtreeRow[]> {
  const rows = (await executor.execute(sql`
    with recursive sub as (
      select id, parent_note_id, depth, deleted_at, deleted_cascade_id, archived_at, archived_cascade_id
      from notes where id = ${rootId} and user_id = ${userId}
      union all
      select n.id, n.parent_note_id, n.depth, n.deleted_at, n.deleted_cascade_id, n.archived_at, n.archived_cascade_id
      from notes n join sub s on n.parent_note_id = s.id
      where n.user_id = ${userId}
    )
    select * from sub`)) as unknown as RawRow[];
  return rows.map((r) => ({
    id: r.id,
    parentId: r.parent_note_id,
    depth: r.depth,
    deletedAt: r.deleted_at,
    deletedCascadeId: r.deleted_cascade_id,
    archivedAt: r.archived_at,
    archivedCascadeId: r.archived_cascade_id,
  }));
}

async function loadNoteRow(executor: Executor, userId: string, id: string) {
  const [row] = await executor
    .select({
      id: notes.id,
      parentId: notes.parentNoteId,
      depth: notes.depth,
      projectId: notes.projectId,
      deletedAt: notes.deletedAt,
      archivedAt: notes.archivedAt,
    })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId)))
    .limit(1);
  return row ?? null;
}

const siblingsOf = (userId: string, parentId: string | null) =>
  and(
    eq(notes.userId, userId),
    isNull(notes.deletedAt),
    parentId === null ? isNull(notes.parentNoteId) : eq(notes.parentNoteId, parentId),
  );

/** The sort order that puts a note first among the live notes of one parent. */
export async function orderAtTopOf(
  executor: Executor,
  userId: string,
  parentId: string | null,
): Promise<number> {
  const [row] = await executor
    .select({ min: sql<number | null>`min(${notes.sortOrder})` })
    .from(notes)
    .where(siblingsOf(userId, parentId));
  return orderAtTop(row?.min ?? null);
}

/**
 * Updates that must not look like editing: arranging notes does not change "last updated". (Trash,
 * archive and restore do, as they always have: a restored note counts as touched.)
 */
const keepUpdatedAt = { updatedAt: sql`${notes.updatedAt}` };

// ---- Creating ---------------------------------------------------------------------------------

export type CreateSubNoteInput = {
  parentId: string;
  title?: string;
  emoji?: string | null;
  contentJson?: TiptapDoc;
};

/**
 * A new note under `parentId`, in the parent's project, with no tags, first among its siblings.
 * Saved at once (an explicit action, unlike a blank new top-level note).
 */
export async function createSubNote(
  userId: string,
  input: CreateSubNoteInput,
  outer?: Tx,
): Promise<{
  id: string;
  version: number;
  depth: number;
  projectId: string | null;
  sortOrder: number;
}> {
  return inTransaction(outer, async (tx) => {
    await lockTree(tx, userId);
    const parent = await loadNoteRow(tx, userId, input.parentId);
    if (!parent || parent.deletedAt) throw new AppError("NOT_FOUND");
    if (parent.archivedAt) {
      throw new AppError("VALIDATION_ERROR", "Unarchive this note to add a sub-note to it.");
    }
    if (!canHaveSubNote(parent.depth)) throw new AppError("VALIDATION_ERROR", DEPTH_MESSAGE);

    const [created] = await tx
      .insert(notes)
      .values({
        userId,
        parentNoteId: parent.id,
        depth: parent.depth + 1,
        projectId: parent.projectId,
        sortOrder: await orderAtTopOf(tx, userId, parent.id),
        title: input.title ?? "",
        emoji: input.emoji ?? null,
        contentJson: input.contentJson ?? EMPTY_DOC,
        contentText: "",
      })
      .returning({
        id: notes.id,
        version: notes.version,
        depth: notes.depth,
        projectId: notes.projectId,
        sortOrder: notes.sortOrder,
      });
    if (!created) throw new AppError("INTERNAL_ERROR");
    return created;
  });
}

// ---- Moving -----------------------------------------------------------------------------------

export type MoveNoteInput = {
  id: string;
  /** The new parent, or null for the top level. */
  parentId: string | null;
  /** The sibling that will sit just above the note. */
  beforeId?: string | null;
  /** The sibling that will sit just below it. With neither, the note goes first. */
  afterId?: string | null;
};

/**
 * Moves a note and everything under it to a new parent (or the top level) and to a place among its
 * new siblings. Refuses a loop and anything that would end deeper than five levels, counting the
 * note's own sub-notes (including archived ones and ones in Trash, so a restore can never break
 * the limit). Does not change "last updated".
 */
export async function moveNote(
  userId: string,
  input: MoveNoteInput,
): Promise<{ depth: number; sortOrder: number; parentId: string | null }> {
  return db.transaction(async (tx) => {
    await lockTree(tx, userId);

    const subtree = await loadSubtree(tx, userId, input.id);
    const root = subtree.find((r) => r.id === input.id);
    if (!root || root.deletedAt) throw new AppError("NOT_FOUND");

    let parentDepth = 0;
    if (input.parentId !== null) {
      if (subtree.some((r) => r.id === input.parentId)) {
        throw new AppError("VALIDATION_ERROR", CYCLE_MESSAGE);
      }
      const parent = await loadNoteRow(tx, userId, input.parentId);
      if (!parent || parent.deletedAt) throw new AppError("NOT_FOUND");
      if (parent.archivedAt) {
        throw new AppError("VALIDATION_ERROR", "Unarchive that note before moving notes into it.");
      }
      parentDepth = parent.depth;
    }

    const height = Math.max(...subtree.map((r) => r.depth)) - root.depth;
    const fit = checkDepth(parentDepth, height);
    if (!fit.ok) throw new AppError("VALIDATION_ERROR", fit.reason);
    const shift = fit.depth - root.depth;

    const neighbour = async (id: string | null | undefined) => {
      if (!id) return null;
      if (id === input.id)
        throw new AppError("VALIDATION_ERROR", "A note can't go next to itself.");
      const [row] = await tx
        .select({ id: notes.id, sortOrder: notes.sortOrder })
        .from(notes)
        .where(and(siblingsOf(userId, input.parentId), eq(notes.id, id)))
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND");
      return row;
    };
    const above = await neighbour(input.beforeId);
    const below = await neighbour(input.afterId);

    let sortOrder: number;
    let renumbered: Map<string, number> | null = null;
    if (!above && !below) {
      const [row] = await tx
        .select({ min: sql<number | null>`min(${notes.sortOrder})` })
        .from(notes)
        .where(and(siblingsOf(userId, input.parentId), ne(notes.id, input.id)));
      sortOrder = orderAtTop(row?.min ?? null);
    } else {
      const placed = siblingOrder(above?.sortOrder ?? null, below?.sortOrder ?? null);
      sortOrder = placed.order;
      if (placed.needsRenumber) {
        const others = await tx
          .select({ id: notes.id })
          .from(notes)
          .where(and(siblingsOf(userId, input.parentId), ne(notes.id, input.id)))
          .orderBy(asc(notes.sortOrder), asc(notes.createdAt));
        const ids = others.map((r) => r.id);
        const at = above ? ids.indexOf(above.id) + 1 : below ? ids.indexOf(below.id) : ids.length;
        ids.splice(at, 0, input.id);
        renumbered = renumber(ids);
        sortOrder = renumbered.get(input.id) as number;
      }
    }

    await tx
      .update(notes)
      .set({ parentNoteId: input.parentId, depth: fit.depth, sortOrder, ...keepUpdatedAt })
      .where(and(eq(notes.id, input.id), eq(notes.userId, userId)));

    if (shift !== 0) {
      const descendants = subtree.filter((r) => r.id !== input.id).map((r) => r.id);
      if (descendants.length > 0) {
        await tx
          .update(notes)
          .set({ depth: sql`${notes.depth} + ${shift}`, ...keepUpdatedAt })
          .where(and(eq(notes.userId, userId), inArray(notes.id, descendants)));
      }
    }
    if (renumbered) {
      for (const [id, order] of renumbered) {
        if (id === input.id) continue;
        await tx
          .update(notes)
          .set({ sortOrder: order, ...keepUpdatedAt })
          .where(and(eq(notes.id, id), eq(notes.userId, userId)));
      }
    }
    return { depth: fit.depth, sortOrder, parentId: input.parentId };
  });
}

// ---- Trash and archive ------------------------------------------------------------------------

/** Moves a note and its live sub-notes to Trash with one cascade id. */
export async function deleteNote(
  userId: string,
  id: string,
): Promise<{ deletedAt: string; subNotes: number }> {
  return db.transaction(async (tx) => {
    await lockTree(tx, userId);
    const rows = await loadSubtree(tx, userId, id);
    const root = rows.find((r) => r.id === id);
    if (!root || root.deletedAt) throw new AppError("NOT_FOUND");

    const set = cascadeSet(rows, id, "deleted");
    const now = new Date();
    await tx
      .update(notes)
      .set({ deletedAt: now, deletedCascadeId: uuidv7() })
      .where(and(eq(notes.userId, userId), inArray(notes.id, set)));
    return { deletedAt: now.toISOString(), subNotes: subNoteCount(set) };
  });
}

/**
 * Brings back a note and the sub-notes that went with it, and only those. A sub-note whose parent
 * is still in Trash is refused (`CONFLICT` with the `parent` field set to `top-level`) until the
 * caller asks for `restoreNoteAsTopLevel`.
 */
export async function restoreNote(
  userId: string,
  id: string,
): Promise<{ restored: number; subNotes: number }> {
  return db.transaction(async (tx) => {
    await lockTree(tx, userId);
    const rows = await loadSubtree(tx, userId, id);
    const root = rows.find((r) => r.id === id);
    if (!root || !root.deletedAt) throw new AppError("NOT_FOUND");

    if (root.parentId) {
      const parent = await loadNoteRow(tx, userId, root.parentId);
      if (needsTopLevel(parent ? { at: parent.deletedAt } : null)) {
        throw new AppError(
          "CONFLICT",
          "Its note is still in Trash. Restore it as a top-level note?",
          {
            fieldErrors: { [TOP_LEVEL_FIELD]: TOP_LEVEL_VALUE },
          },
        );
      }
    }
    const set = restoreSet(rows, id, "deleted");
    await tx
      .update(notes)
      .set({ deletedAt: null, deletedCascadeId: null })
      .where(and(eq(notes.userId, userId), inArray(notes.id, set)));
    return { restored: set.length, subNotes: subNoteCount(set) };
  });
}

/** Restores a note as a top-level note: for a sub-note whose parent is still in Trash. */
export async function restoreNoteAsTopLevel(
  userId: string,
  id: string,
): Promise<{ restored: number; subNotes: number }> {
  return db.transaction(async (tx) => {
    await lockTree(tx, userId);
    const rows = await loadSubtree(tx, userId, id);
    const root = rows.find((r) => r.id === id);
    if (!root || !root.deletedAt) throw new AppError("NOT_FOUND");

    const set = restoreSet(rows, id, "deleted");
    const shift = 1 - root.depth;
    await tx
      .update(notes)
      .set({
        deletedAt: null,
        deletedCascadeId: null,
        parentNoteId: null,
        depth: 1,
        sortOrder: await orderAtTopOf(tx, userId, null),
      })
      .where(and(eq(notes.id, id), eq(notes.userId, userId)));
    const rest = rows.filter((r) => r.id !== id).map((r) => r.id);
    if (rest.length > 0 && shift !== 0) {
      await tx
        .update(notes)
        .set({ depth: sql`${notes.depth} + ${shift}`, ...keepUpdatedAt })
        .where(and(eq(notes.userId, userId), inArray(notes.id, rest)));
    }
    const others = set.filter((s) => s !== id);
    if (others.length > 0) {
      await tx
        .update(notes)
        .set({ deletedAt: null, deletedCascadeId: null })
        .where(and(eq(notes.userId, userId), inArray(notes.id, others)));
    }
    return { restored: set.length, subNotes: subNoteCount(set) };
  });
}

/** Archives a note with its sub-notes, or unarchives exactly the set that was archived with it. */
export async function archiveNote(
  userId: string,
  id: string,
  archived: boolean,
  options: { asTopLevel?: boolean } = {},
): Promise<{ affected: number; subNotes: number }> {
  return db.transaction(async (tx) => {
    await lockTree(tx, userId);
    const rows = await loadSubtree(tx, userId, id);
    const root = rows.find((r) => r.id === id);
    if (!root || root.deletedAt) throw new AppError("NOT_FOUND");

    if (archived) {
      if (root.archivedAt) return { affected: 0, subNotes: 0 };
      const set = cascadeSet(rows, id, "archived");
      await tx
        .update(notes)
        .set({ archivedAt: new Date(), archivedCascadeId: uuidv7() })
        .where(and(eq(notes.userId, userId), inArray(notes.id, set)));
      return { affected: set.length, subNotes: subNoteCount(set) };
    }

    if (!root.archivedAt) return { affected: 0, subNotes: 0 };
    const set = restoreSet(rows, id, "archived");
    let parentArchived = false;
    if (root.parentId) {
      const parent = await loadNoteRow(tx, userId, root.parentId);
      parentArchived = needsTopLevel(parent ? { at: parent.archivedAt } : null);
    }
    if (parentArchived && !options.asTopLevel) {
      throw new AppError(
        "CONFLICT",
        "Its note is still archived. Unarchive it as a top-level note?",
        {
          fieldErrors: { [TOP_LEVEL_FIELD]: TOP_LEVEL_VALUE },
        },
      );
    }
    await tx
      .update(notes)
      .set({ archivedAt: null, archivedCascadeId: null })
      .where(and(eq(notes.userId, userId), inArray(notes.id, set)));
    if (parentArchived) {
      const shift = 1 - root.depth;
      await tx
        .update(notes)
        .set({
          parentNoteId: null,
          depth: 1,
          sortOrder: await orderAtTopOf(tx, userId, null),
          ...keepUpdatedAt,
        })
        .where(and(eq(notes.id, id), eq(notes.userId, userId)));
      const rest = rows.filter((r) => r.id !== id).map((r) => r.id);
      if (rest.length > 0 && shift !== 0) {
        await tx
          .update(notes)
          .set({ depth: sql`${notes.depth} + ${shift}`, ...keepUpdatedAt })
          .where(and(eq(notes.userId, userId), inArray(notes.id, rest)));
      }
    }
    return { affected: set.length, subNotes: subNoteCount(set) };
  });
}

/** How many notes permanently deleting `id` would remove (itself and everything below it). */
export async function countSubtree(executor: Executor, userId: string, id: string) {
  return (await loadSubtree(executor, userId, id)).length;
}

/** Only from Trash. The sub-notes go with it through the foreign key; links and tags cascade too. */
export async function permanentlyDeleteNote(
  userId: string,
  id: string,
): Promise<{ removed: number; subNotes: number }> {
  return db.transaction(async (tx) => {
    await lockTree(tx, userId);
    const rows = await loadSubtree(tx, userId, id);
    const root = rows.find((r) => r.id === id);
    if (!root) throw new AppError("NOT_FOUND");
    if (!root.deletedAt) throw new AppError("CONFLICT", "Move it to Trash first.");
    await tx.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, userId)));
    return { removed: rows.length, subNotes: rows.length - 1 };
  });
}
