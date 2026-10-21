import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { stickyTasks } from "@/db/queries/task-filters";
import { canvases, tasks } from "@/db/schema";
import type { StickyInfoDTO, TodayStickyDTO } from "@/lib/canvas/dto";
import { joinStickyText } from "@/lib/canvas/sticky";
import type { ColorToken } from "@/lib/colors";

// Reads of sticky notes (V3 feature 01 §13). A sticky note is a task of its own kind that is also an element of a drawing.
// Every read is scoped to the signed-in person, and a note on a canvas in Trash or archived is not returned in Today.

/** A sticky that is on a canvas the person can see. */
const onLiveCanvas = sql`exists (select 1 from canvases c where c.id = "tasks"."sticky_canvas_id" and c.user_id = "tasks"."user_id" and c.deleted_at is null and c.archived_at is null)`;

const OPEN = ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"] as const;

/** The tasks of a drawing's sticky notes (live ones), for the badges and the note toolbar. */
export async function listCanvasStickies(
  userId: string,
  canvasId: string,
): Promise<StickyInfoDTO[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.stickyCanvasId, canvasId),
        stickyTasks,
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    dueTime: row.dueTime ? row.dueTime.slice(0, 5) : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    text: joinStickyText(row.title, row.descriptionText),
  }));
}

export const TODAY_STICKY_LIMIT = 20;

/**
 * Today's "Sticky notes" section: open stickies that are In progress, or due today or overdue, on live canvases, newest
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
    onLiveCanvas,
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
        canvasId: canvases.id,
        canvasTitle: canvases.title,
        canvasEmoji: canvases.emoji,
      })
      .from(tasks)
      .innerJoin(canvases, eq(canvases.id, tasks.stickyCanvasId))
      .where(where)
      .orderBy(desc(tasks.updatedAt))
      .limit(limit),
    db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(where),
  ]);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      tone: (r.tone as ColorToken | null) ?? null,
      status: r.status,
      dueDate: r.dueDate,
      dueTime: r.dueTime ? r.dueTime.slice(0, 5) : null,
      canvasId: r.canvasId,
      canvasTitle: r.canvasTitle,
      canvasEmoji: r.canvasEmoji,
    })),
    total: count?.n ?? 0,
  };
}
