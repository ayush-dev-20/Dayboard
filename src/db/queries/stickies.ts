import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projectRefsFor } from "@/db/queries/meta";
import { stickyTasks } from "@/db/queries/task-filters";
import { canvases, tasks } from "@/db/schema";
import { sanitizeBoard, joinStickyText, type Board } from "@/lib/canvas/board";
import type { BoardDTO, StickyDTO, TodayStickyDTO } from "@/lib/canvas/dto";
import type { CanvasKind } from "@/lib/canvas/types";
import type { ColorToken } from "@/lib/colors";

// Reads of sticky boards and their sticky notes (V3 feature 01 §13). A sticky note is a task of its own kind, so every
// read is scoped to the signed-in person, and a sticky on a board in Trash or archived is not returned anywhere: restoring
// the board brings its stickies back.

/** A sticky that is on a board the person can see. */
const onLiveBoard = sql`exists (select 1 from canvases c where c.id = "tasks"."board_canvas_id" and c.user_id = "tasks"."user_id" and c.deleted_at is null and c.archived_at is null)`;

const OPEN = ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"] as const;

export function toStickyDTO(row: typeof tasks.$inferSelect): StickyDTO {
  return {
    id: row.id,
    text: joinStickyText(row.title, row.descriptionText),
    columnId: row.boardColumnId ?? "",
    tone: (row.stickyTone as ColorToken | null) ?? null,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: row.dueTime ? row.dueTime.slice(0, 5) : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A board with its columns and live stickies, or null when it isn't the person's (or is in Trash). */
export async function getBoard(userId: string, canvasId: string): Promise<BoardDTO | null> {
  const [row] = await db
    .select()
    .from(canvases)
    .where(
      and(
        eq(canvases.id, canvasId),
        eq(canvases.userId, userId),
        eq(canvases.kind, "BOARD"),
        isNull(canvases.deletedAt),
      ),
    )
    .limit(1);
  if (!row || !row.boardJson) return null;

  const [refs, stickies] = await Promise.all([
    projectRefsFor(db, userId, [row.projectId]),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.boardCanvasId, canvasId),
          stickyTasks,
          isNull(tasks.deletedAt),
          isNull(tasks.archivedAt),
        ),
      )
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt)),
  ]);
  const board = sanitizeBoard(row.boardJson);
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    kind: row.kind as CanvasKind,
    elementCount: 0,
    stickyCount: stickies.length,
    project: row.projectId ? (refs.get(row.projectId) ?? null) : null,
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    board,
    stickies: stickies.map(toStickyDTO),
  };
}

/** How many live stickies each board has, for the list ("18 sticky notes"). */
export async function countStickies(
  userId: string,
  canvasIds: readonly string[],
): Promise<Map<string, number>> {
  if (canvasIds.length === 0) return new Map();
  const rows = await db
    .select({ id: tasks.boardCanvasId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        stickyTasks,
        isNull(tasks.deletedAt),
        isNull(tasks.archivedAt),
        inArray(tasks.boardCanvasId, [...canvasIds]),
      ),
    )
    .groupBy(tasks.boardCanvasId);
  return new Map(rows.flatMap((r) => (r.id ? [[r.id, r.n] as const] : [])));
}

export const TODAY_STICKY_LIMIT = 20;

/**
 * Today's "Sticky notes" section: open stickies that are In progress, or due today or overdue, on live boards, newest
 * activity first. `total` is how many there are in all, for "Show all N".
 */
export async function listStickiesForToday(
  userId: string,
  today: string,
  limit = TODAY_STICKY_LIMIT,
): Promise<{ rows: TodayStickyDTO[]; total: number }> {
  const where = and(
    eq(tasks.userId, userId),
    stickyTasks,
    isNull(tasks.deletedAt),
    isNull(tasks.archivedAt),
    inArray(tasks.status, [...OPEN]),
    or(eq(tasks.status, "IN_PROGRESS"), lte(tasks.dueDate, today)),
    onLiveBoard,
  );
  const [rows, [count]] = await Promise.all([
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        tone: tasks.stickyTone,
        status: tasks.status,
        dueDate: tasks.dueDate,
        dueTime: tasks.dueTime,
        boardId: canvases.id,
        boardTitle: canvases.title,
        boardEmoji: canvases.emoji,
      })
      .from(tasks)
      .innerJoin(canvases, eq(canvases.id, tasks.boardCanvasId))
      .where(where)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      tone: (r.tone as ColorToken | null) ?? null,
      status: r.status,
      dueDate: r.dueDate,
      dueTime: r.dueTime ? r.dueTime.slice(0, 5) : null,
      boardId: r.boardId,
      boardTitle: r.boardTitle,
      boardEmoji: r.boardEmoji,
    })),
    total: count?.n ?? 0,
  };
}

/** The columns of a board, for the mutations that need them (null when the board isn't the person's). */
export async function getBoardColumns(userId: string, canvasId: string): Promise<Board | null> {
  const [row] = await db
    .select({ boardJson: canvases.boardJson })
    .from(canvases)
    .where(and(eq(canvases.id, canvasId), eq(canvases.userId, userId), eq(canvases.kind, "BOARD")))
    .limit(1);
  return row?.boardJson ? sanitizeBoard(row.boardJson) : null;
}
