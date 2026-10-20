import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { canvases, tasks, type Task } from "@/db/schema";
import {
  columnAfterStatusChange,
  columnById,
  columnForStatus,
  sanitizeBoard,
} from "@/lib/canvas/board";
import { AppError } from "@/lib/errors";
import { statusPatch } from "@/lib/tasks/status";
import type { TaskStatus } from "@/lib/tasks/status";
import { orderAtBottom } from "@/lib/tasks/ordering";

// Where a sticky note sits when its status changes somewhere other than the board (V3 feature 01 §13.2): completing it in
// Today, changing it in the task panel, undoing a completion. The column decides the status on the board, and the status
// decides the column everywhere else: the sticky goes to the first column of its board with that status, at the bottom.
// With no such column it stays where it is, and the board shows its status as text. Kept apart from `tasks.ts` and
// `stickies.ts` so both can use it.

/** The order a card takes at the bottom of a column. */
export async function bottomOfColumn(
  executor: Executor,
  userId: string,
  canvasId: string,
  columnId: string,
): Promise<number> {
  const [row] = await executor
    .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.boardCanvasId, canvasId),
        eq(tasks.boardColumnId, columnId),
        eq(tasks.kind, "STICKY"),
        isNull(tasks.deletedAt),
      ),
    );
  return orderAtBottom(row?.max ?? null);
}

/**
 * The extra fields a status change gives a sticky note: its new column and its place at the bottom of it. Empty for an
 * ordinary task, and for a sticky whose column already fits (or whose board has no column for that status).
 */
export async function stickyPlacementFor(
  executor: Executor,
  task: Pick<Task, "userId" | "kind" | "boardCanvasId" | "boardColumnId">,
  status: TaskStatus,
): Promise<{ boardColumnId?: string; sortOrder?: number }> {
  if (task.kind !== "STICKY" || !task.boardCanvasId || !task.boardColumnId) return {};
  const [canvas] = await executor
    .select({ boardJson: canvases.boardJson })
    .from(canvases)
    .where(and(eq(canvases.id, task.boardCanvasId), eq(canvases.userId, task.userId)))
    .limit(1);
  if (!canvas?.boardJson) return {};
  let target;
  try {
    target = columnAfterStatusChange(sanitizeBoard(canvas.boardJson), task.boardColumnId, status);
  } catch {
    return {};
  }
  if (!target || target.id === task.boardColumnId) return {};
  return {
    boardColumnId: target.id,
    sortOrder: await bottomOfColumn(executor, task.userId, task.boardCanvasId, target.id),
  };
}

/**
 * Before a sticky comes back from Trash: its board must be out of Trash, and it must sit in a column that exists. If its
 * column was deleted while it was away it goes to the first column with its status, or else the first column (taking that
 * column's status). Returns the extra fields to write with the restore.
 */
export async function stickyRestorePatch(
  executor: Executor,
  task: Pick<Task, "userId" | "kind" | "boardCanvasId" | "boardColumnId" | "status">,
): Promise<Record<string, unknown>> {
  if (task.kind !== "STICKY" || !task.boardCanvasId) return {};
  const [canvas] = await executor
    .select({ boardJson: canvases.boardJson, deletedAt: canvases.deletedAt })
    .from(canvases)
    .where(and(eq(canvases.id, task.boardCanvasId), eq(canvases.userId, task.userId)))
    .limit(1);
  if (!canvas || canvas.deletedAt || !canvas.boardJson) {
    throw new AppError("CONFLICT", "Restore the board first.");
  }
  const board = sanitizeBoard(canvas.boardJson);
  if (task.boardColumnId && columnById(board, task.boardColumnId)) return {};
  const target = columnForStatus(board, task.status) ?? board.columns[0]!;
  return {
    boardColumnId: target.id,
    sortOrder: await bottomOfColumn(executor, task.userId, task.boardCanvasId, target.id),
    ...(target.status === task.status ? {} : statusPatch(target.status, new Date())),
  };
}
