import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Executor, Tx } from "@/db/executor";
import { bottomOfColumn } from "@/db/mutations/sticky-column";
import { deleteTask, restoreTask } from "@/db/mutations/tasks";
import { toStickyDTO } from "@/db/queries/stickies";
import { canvases, taskCanvases, tasks } from "@/db/schema";
import {
  BOARD_LIMITS,
  BoardError,
  boardSearchText,
  columnById,
  planDeleteColumn,
  sanitizeBoard,
  splitStickyText,
  type Board,
  type Column,
  type ColumnStatus,
} from "@/lib/canvas/board";
import type { CanvasSaveResult, StickyDTO } from "@/lib/canvas/dto";
import type { TiptapDoc } from "@/lib/editor/types";
import { AppError } from "@/lib/errors";
import { logTaskUpserts } from "@/lib/sync/change-log";
import type { ColorToken } from "@/lib/colors";
import { orderAtTop, orderBetween, renumber } from "@/lib/tasks/ordering";
import { statusPatch } from "@/lib/tasks/status";

// Writes of sticky notes and board columns (V3 feature 01 §13.3). A sticky note is a task of its own kind, so every write
// goes through the same rules as a task: the status and completion time come from `statusPatch`, ordering from
// `orderBetween`, Trash from the task delete, and each change is written to the sync log in the same transaction. Every
// function takes the signed-in person's id first and puts it in every WHERE clause.

const stickyOwned = (userId: string, id: string, includeDeleted = false) =>
  and(
    eq(tasks.id, id),
    eq(tasks.userId, userId),
    eq(tasks.kind, "STICKY"),
    includeDeleted ? undefined : isNull(tasks.deletedAt),
  );

type BoardRow = {
  id: string;
  version: number;
  projectId: string | null;
  title: string;
  board: Board;
  deletedAt: Date | null;
  archivedAt: Date | null;
};

/** A board of the person's own that is not in Trash, with its columns. Anything else is NOT_FOUND. */
async function loadBoard(
  executor: Executor,
  userId: string,
  canvasId: string,
  options: { lock?: boolean; includeDeleted?: boolean } = {},
): Promise<BoardRow> {
  const query = executor
    .select()
    .from(canvases)
    .where(
      and(
        eq(canvases.id, canvasId),
        eq(canvases.userId, userId),
        eq(canvases.kind, "BOARD"),
        options.includeDeleted ? undefined : isNull(canvases.deletedAt),
      ),
    )
    .limit(1);
  const [row] = await (options.lock ? query.for("update") : query);
  if (!row || !row.boardJson) throw new AppError("NOT_FOUND");
  return {
    id: row.id,
    version: row.version,
    projectId: row.projectId,
    title: row.title,
    board: sanitizeBoard(row.boardJson),
    deletedAt: row.deletedAt,
    archivedAt: row.archivedAt,
  };
}

async function loadSticky(executor: Executor, userId: string, id: string, includeDeleted = false) {
  const [row] = await executor
    .select()
    .from(tasks)
    .where(stickyOwned(userId, id, includeDeleted))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** A column on the board, or NOT_FOUND. */
function columnOf(board: Board, columnId: string): Column {
  const column = columnById(board, columnId);
  if (!column) throw new AppError("NOT_FOUND");
  return column;
}

/** Plain text, validated: a `BoardError` becomes a plain validation message. */
function splitText(text: string) {
  try {
    return splitStickyText(text);
  } catch (error) {
    if (error instanceof BoardError) {
      throw new AppError("VALIDATION_ERROR", error.message, {
        fieldErrors: { text: error.message },
      });
    }
    throw error;
  }
}

/** The description as the task panel's editor holds it: one paragraph per line. */
function descriptionDoc(description: string | null): TiptapDoc | null {
  if (!description) return null;
  return {
    type: "doc",
    content: description
      .split("\n")
      .map((line) =>
        line.trim()
          ? { type: "paragraph", content: [{ type: "text", text: line }] }
          : { type: "paragraph" },
      ),
  };
}

async function assertRoom(executor: Executor, userId: string, canvasId: string, columnId: string) {
  const [row] = await executor
    .select({
      board: sql<number>`count(*)::int`,
      column: sql<number>`count(*) filter (where ${tasks.boardColumnId} = ${columnId})::int`,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.boardCanvasId, canvasId),
        eq(tasks.kind, "STICKY"),
        isNull(tasks.deletedAt),
      ),
    );
  if ((row?.board ?? 0) >= BOARD_LIMITS.stickiesPerBoard) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      `A board can hold ${BOARD_LIMITS.stickiesPerBoard} sticky notes. Delete some to add more.`,
    );
  }
  if ((row?.column ?? 0) >= BOARD_LIMITS.stickiesPerColumn) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      `A column can hold ${BOARD_LIMITS.stickiesPerColumn} sticky notes. Move some to another column.`,
    );
  }
}

/** Live stickies of one column in order, optionally without one of them. */
async function columnStickies(
  executor: Executor,
  userId: string,
  canvasId: string,
  columnId: string,
  without?: string,
) {
  return executor
    .select({ id: tasks.id, sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.boardCanvasId, canvasId),
        eq(tasks.boardColumnId, columnId),
        eq(tasks.kind, "STICKY"),
        isNull(tasks.deletedAt),
        without ? ne(tasks.id, without) : undefined,
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
}

export async function createSticky(
  userId: string,
  input: { canvasId: string; columnId: string; text: string; tone?: ColorToken | null },
  outer?: Tx,
): Promise<StickyDTO> {
  const run = async (tx: Tx) => {
    const board = await loadBoard(tx, userId, input.canvasId);
    const column = columnOf(board.board, input.columnId);
    const { title, description } = splitText(input.text);
    await assertRoom(tx, userId, board.id, column.id);

    const [created] = await tx
      .insert(tasks)
      .values({
        userId,
        projectId: board.projectId,
        kind: "STICKY",
        boardCanvasId: board.id,
        boardColumnId: column.id,
        stickyTone: input.tone ?? null,
        title,
        descriptionJson: descriptionDoc(description),
        descriptionText: description,
        ...statusPatch(column.status, new Date()),
        sortOrder: await bottomOfColumn(tx, userId, board.id, column.id),
      })
      .returning();
    if (!created) throw new AppError("INTERNAL_ERROR");
    await logTaskUpserts(tx, userId, [created.id], { bump: false });
    return toStickyDTO(created);
  };
  return outer ? run(outer) : db.transaction(run);
}

export async function updateSticky(
  userId: string,
  input: { id: string; text?: string; tone?: ColorToken | null },
): Promise<StickyDTO> {
  return db.transaction(async (tx) => {
    const sticky = await loadSticky(tx, userId, input.id);
    const patch: Partial<typeof tasks.$inferInsert> = {};
    if (input.text !== undefined) {
      const { title, description } = splitText(input.text);
      patch.title = title;
      patch.descriptionJson = descriptionDoc(description);
      patch.descriptionText = description;
    }
    if (input.tone !== undefined) patch.stickyTone = input.tone;
    if (Object.keys(patch).length === 0) return toStickyDTO(sticky);
    const [updated] = await tx
      .update(tasks)
      .set(patch)
      .where(stickyOwned(userId, input.id))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND");
    await logTaskUpserts(tx, userId, [updated.id], { bump: true });
    return toStickyDTO(updated);
  });
}

/**
 * Puts a sticky note in a column, before another one or at the end. The status follows the column in the same
 * transaction: Completed sets the completion time, leaving it clears it, Cancelled cancels.
 */
export async function moveSticky(
  userId: string,
  input: { id: string; columnId: string; beforeId: string | null },
): Promise<StickyDTO> {
  return db.transaction(async (tx) => {
    const sticky = await loadSticky(tx, userId, input.id);
    if (!sticky.boardCanvasId) throw new AppError("NOT_FOUND");
    const board = await loadBoard(tx, userId, sticky.boardCanvasId);
    const column = columnOf(board.board, input.columnId);
    if (input.beforeId === input.id) {
      throw new AppError("VALIDATION_ERROR", "A sticky note can't go before itself.");
    }
    if (column.id !== sticky.boardColumnId) await assertRoom(tx, userId, board.id, column.id);

    const siblings = await columnStickies(tx, userId, board.id, column.id, input.id);
    let above: number | null = null;
    let below: number | null = null;
    let index = siblings.length;
    if (input.beforeId) {
      index = siblings.findIndex((s) => s.id === input.beforeId);
      if (index === -1) throw new AppError("NOT_FOUND");
      below = siblings[index]!.sortOrder;
      above = index > 0 ? siblings[index - 1]!.sortOrder : null;
    } else if (siblings.length > 0) {
      above = siblings[siblings.length - 1]!.sortOrder;
    }
    const { order, needsRenumber } = orderBetween(above, below);

    // A sticky that stays in its column keeps its status (it may differ when the board has no column for it).
    const statusChanges = column.id !== sticky.boardColumnId && sticky.status !== column.status;
    const patch: Partial<typeof tasks.$inferInsert> = {
      boardColumnId: column.id,
      sortOrder: order,
      ...(statusChanges ? statusPatch(column.status, new Date()) : {}),
    };

    if (!needsRenumber) {
      const [updated] = await tx
        .update(tasks)
        .set(patch)
        .where(stickyOwned(userId, input.id))
        .returning();
      if (!updated) throw new AppError("NOT_FOUND");
      await logTaskUpserts(tx, userId, [updated.id], { bump: true });
      return toStickyDTO(updated);
    }

    // No room left between the neighbours: the whole column is numbered again, with this one in its place.
    const ids = siblings.map((s) => s.id);
    ids.splice(index, 0, input.id);
    const fresh = renumber(ids);
    for (const [id, sortOrder] of fresh) {
      await tx
        .update(tasks)
        .set(id === input.id ? { ...patch, sortOrder } : { sortOrder })
        .where(stickyOwned(userId, id));
    }
    await logTaskUpserts(tx, userId, [...fresh.keys()], { bump: true });
    const [moved] = await tx.select().from(tasks).where(stickyOwned(userId, input.id)).limit(1);
    if (!moved) throw new AppError("NOT_FOUND");
    return toStickyDTO(moved);
  });
}

/** A copy just below the original, with the same text and colour. It takes its column's status, not the original's. */
export async function duplicateSticky(userId: string, id: string): Promise<StickyDTO> {
  return db.transaction(async (tx) => {
    const original = await loadSticky(tx, userId, id);
    if (!original.boardCanvasId || !original.boardColumnId) throw new AppError("NOT_FOUND");
    const board = await loadBoard(tx, userId, original.boardCanvasId);
    const column = columnOf(board.board, original.boardColumnId);
    await assertRoom(tx, userId, board.id, column.id);

    const siblings = await columnStickies(tx, userId, board.id, column.id);
    const at = siblings.findIndex((s) => s.id === id);
    const below = siblings[at + 1]?.sortOrder ?? null;
    const { order, needsRenumber } = orderBetween(original.sortOrder, below);

    const [created] = await tx
      .insert(tasks)
      .values({
        userId,
        projectId: original.projectId,
        kind: "STICKY",
        boardCanvasId: board.id,
        boardColumnId: column.id,
        stickyTone: original.stickyTone,
        title: original.title,
        descriptionJson: original.descriptionJson,
        descriptionText: original.descriptionText,
        priority: original.priority,
        dueDate: original.dueDate,
        dueTime: original.dueTime,
        ...statusPatch(column.status, new Date()),
        sortOrder: needsRenumber ? original.sortOrder + 0.5 : order,
      })
      .returning();
    if (!created) throw new AppError("INTERNAL_ERROR");
    await logTaskUpserts(tx, userId, [created.id], { bump: false });
    if (needsRenumber) {
      const ids = siblings.map((s) => s.id);
      ids.splice(at + 1, 0, created.id);
      const fresh = renumber(ids);
      for (const [taskId, sortOrder] of fresh) {
        await tx.update(tasks).set({ sortOrder }).where(stickyOwned(userId, taskId));
      }
      await logTaskUpserts(tx, userId, [...fresh.keys()], { bump: true });
    }
    const [row] = await tx.select().from(tasks).where(stickyOwned(userId, created.id)).limit(1);
    return toStickyDTO(row ?? created);
  });
}

/** To Trash with Undo: the task delete. */
export async function deleteSticky(userId: string, id: string): Promise<{ deletedAt: string }> {
  await loadSticky(db, userId, id);
  return deleteTask(userId, id);
}

/**
 * Brings a sticky back. Its board must be out of Trash. If its column was deleted meanwhile it goes to the first column
 * with its status, or else the first column (`restoreTask` does both, so Restore in Trash behaves the same).
 */
export async function restoreSticky(userId: string, id: string): Promise<StickyDTO> {
  await loadSticky(db, userId, id, true);
  await restoreTask(userId, id);
  return toStickyDTO(await loadSticky(db, userId, id));
}

/** The sticky leaves the board and becomes an ordinary task at the top of the list. A link to the board keeps the connection. */
export async function makeStickyRegularTask(userId: string, id: string): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    const sticky = await loadSticky(tx, userId, id);
    const canvasId = sticky.boardCanvasId;
    const [top] = await tx
      .select({ min: sql<number | null>`min(${tasks.sortOrder})` })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.parentTaskId),
          isNull(tasks.deletedAt),
          eq(tasks.kind, "TASK"),
        ),
      );
    const [updated] = await tx
      .update(tasks)
      .set({
        kind: "TASK",
        boardCanvasId: null,
        boardColumnId: null,
        stickyTone: null,
        sortOrder: orderAtTop(top?.min ?? null),
      })
      .where(stickyOwned(userId, id))
      .returning({ id: tasks.id });
    if (!updated) throw new AppError("NOT_FOUND");
    await logTaskUpserts(tx, userId, [updated.id], { bump: true });
    if (canvasId) {
      await tx.insert(taskCanvases).values({ taskId: id, canvasId, userId }).onConflictDoNothing();
    }
    return { id };
  });
}

// ---- Columns -----------------------------------------------------------------------------------------------------------

type ColumnResult =
  | { outcome: "saved"; version: number; updatedAt: string; count: number }
  | Extract<CanvasSaveResult, { outcome: "conflict" }>;

/** Writes the new columns and bumps the version, only if the board is still at the version the page started from. */
async function saveColumns(tx: Tx, userId: string, board: BoardRow, next: Board) {
  const [row] = await tx
    .update(canvases)
    .set({
      boardJson: next,
      sceneText: boardSearchText(board.title, next),
      version: sql`${canvases.version} + 1`,
    })
    .where(
      and(
        eq(canvases.id, board.id),
        eq(canvases.userId, userId),
        eq(canvases.version, board.version),
      ),
    )
    .returning({ version: canvases.version, updatedAt: canvases.updatedAt });
  return row;
}

/**
 * Changes what a column stands for and, in the same transaction, the status of every sticky in it. A stale version is a
 * conflict and changes nothing.
 */
export async function changeColumnStatus(
  userId: string,
  input: { canvasId: string; version: number; columnId: string; status: ColumnStatus },
): Promise<ColumnResult> {
  return db.transaction(async (tx) => {
    const board = await loadBoard(tx, userId, input.canvasId, { lock: true });
    const column = columnOf(board.board, input.columnId);
    if (board.version !== input.version) return { outcome: "conflict", version: board.version };
    if (column.status === input.status) {
      return {
        outcome: "saved",
        version: board.version,
        updatedAt: new Date().toISOString(),
        count: 0,
      };
    }
    const next: Board = {
      v: 1,
      columns: board.board.columns.map((c) =>
        c.id === column.id ? { ...c, status: input.status } : c,
      ),
    };
    const saved = await saveColumns(tx, userId, board, next);
    if (!saved) return { outcome: "conflict", version: board.version };

    const inColumn = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.boardCanvasId, board.id),
          eq(tasks.boardColumnId, column.id),
          eq(tasks.kind, "STICKY"),
          isNull(tasks.deletedAt),
        ),
      );
    const now = new Date();
    for (const { id } of inColumn) {
      await tx.update(tasks).set(statusPatch(input.status, now)).where(stickyOwned(userId, id));
    }
    await logTaskUpserts(
      tx,
      userId,
      inColumn.map((s) => s.id),
      { bump: true },
    );
    return {
      outcome: "saved",
      version: saved.version,
      updatedAt: saved.updatedAt.toISOString(),
      count: inColumn.length,
    };
  });
}

/**
 * Deletes a column. Its stickies go to another column (taking that column's status) or to Trash. The last column cannot
 * be deleted. A stale version is a conflict and changes nothing.
 */
export async function deleteBoardColumn(
  userId: string,
  input: { canvasId: string; version: number; columnId: string; moveTo: string | null },
): Promise<ColumnResult> {
  return db.transaction(async (tx) => {
    const board = await loadBoard(tx, userId, input.canvasId, { lock: true });
    columnOf(board.board, input.columnId);
    if (board.version !== input.version) return { outcome: "conflict", version: board.version };
    const plan = planDeleteColumn(
      board.board,
      input.columnId,
      input.moveTo ? { moveTo: input.moveTo } : "trash",
    );
    if (!plan.ok) {
      throw new AppError(
        plan.reason === "LAST_COLUMN" ? "CONFLICT" : "VALIDATION_ERROR",
        plan.reason === "LAST_COLUMN"
          ? "A board needs at least one column."
          : "Choose a column that is still on the board.",
      );
    }

    const stickies = await columnStickies(tx, userId, board.id, input.columnId);
    const saved = await saveColumns(tx, userId, board, plan.board);
    if (!saved) return { outcome: "conflict", version: board.version };

    const now = new Date();
    if (plan.moveTo) {
      const target = plan.moveTo;
      let order = await bottomOfColumn(tx, userId, board.id, target.id);
      for (const { id } of stickies) {
        await tx
          .update(tasks)
          .set({
            boardColumnId: target.id,
            sortOrder: order,
            ...(plan.statusChanges ? statusPatch(target.status, now) : {}),
          })
          .where(stickyOwned(userId, id));
        order += 1024;
      }
    } else {
      // To Trash with one timestamp, like a task delete; Restore puts each in a column that exists.
      for (const { id } of stickies) {
        await tx.update(tasks).set({ deletedAt: now }).where(stickyOwned(userId, id));
      }
    }
    await logTaskUpserts(
      tx,
      userId,
      stickies.map((s) => s.id),
      { bump: true },
    );
    return {
      outcome: "saved",
      version: saved.version,
      updatedAt: saved.updatedAt.toISOString(),
      count: stickies.length,
    };
  });
}
