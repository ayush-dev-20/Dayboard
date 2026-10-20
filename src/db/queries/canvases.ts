import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { projectRefsFor } from "@/db/queries/meta";
import { canvases, notes, projects, taskCanvases, tasks } from "@/db/schema";
import type { Canvas } from "@/db/schema";
import type {
  CanvasDTO,
  CanvasListItemDTO,
  CanvasTaskDTO,
  CardTargetDTO,
  LinkedCanvasDTO,
} from "@/lib/canvas/dto";
import type { CanvasKind, Scene } from "@/lib/canvas/types";
import type { ProjectRef } from "@/lib/projects/dto";

// Reads of canvases (V3 feature 01 §6). Every one filters by the signed-in person, and nothing in Trash is returned
// unless the caller asks for it. Another person's canvas is simply not there.

const live = (userId: string) => and(eq(canvases.userId, userId), isNull(canvases.deletedAt));

function toListItem(
  row: Canvas,
  refs: Map<string, ProjectRef>,
  stickyCount: number | null = null,
): CanvasListItemDTO {
  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    kind: row.kind as CanvasKind,
    elementCount: row.elementCount,
    stickyCount,
    project: row.projectId ? (refs.get(row.projectId) ?? null) : null,
    archived: row.archivedAt !== null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function withRefs(userId: string, rows: Canvas[]): Promise<CanvasListItemDTO[]> {
  const refs = await projectRefsFor(
    db,
    userId,
    rows.map((r) => r.projectId),
  );
  return rows.map((row) => toListItem(row, refs));
}

/** Canvases that are not archived or in Trash, newest first. */
export async function listCanvases(userId: string): Promise<CanvasListItemDTO[]> {
  const rows = await db
    .select()
    .from(canvases)
    .where(and(live(userId), isNull(canvases.archivedAt)))
    .orderBy(desc(canvases.updatedAt));
  return withRefs(userId, rows);
}

export async function listArchivedCanvases(userId: string): Promise<CanvasListItemDTO[]> {
  const rows = await db
    .select()
    .from(canvases)
    .where(and(live(userId), isNotNull(canvases.archivedAt)))
    .orderBy(desc(canvases.updatedAt));
  return withRefs(userId, rows);
}

/** The latest few for the sidebar: title and emoji only. */
export async function latestCanvases(
  userId: string,
  limit = 5,
): Promise<{ id: string; title: string; emoji: string | null; kind: CanvasKind }[]> {
  const rows = await db
    .select({ id: canvases.id, title: canvases.title, emoji: canvases.emoji, kind: canvases.kind })
    .from(canvases)
    .where(and(live(userId), isNull(canvases.archivedAt)))
    .orderBy(desc(canvases.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, kind: r.kind as CanvasKind }));
}

export async function countLiveCanvases(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(canvases)
    .where(live(userId));
  return row?.n ?? 0;
}

export async function getCanvas(userId: string, id: string): Promise<CanvasDTO | null> {
  const [row] = await db
    .select()
    .from(canvases)
    .where(and(live(userId), eq(canvases.id, id)))
    .limit(1);
  if (!row) return null;
  const refs = await projectRefsFor(db, userId, [row.projectId]);
  return {
    ...toListItem(row, refs),
    version: row.version,
    scene: row.sceneJson as Scene,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The tasks linked to a canvas, open ones first. A task in Trash is left out. */
export async function listLinkedTasks(userId: string, canvasId: string): Promise<CanvasTaskDTO[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      emoji: tasks.emoji,
      status: tasks.status,
      dueDate: tasks.dueDate,
    })
    .from(taskCanvases)
    .innerJoin(tasks, eq(tasks.id, taskCanvases.taskId))
    .where(
      and(
        eq(taskCanvases.canvasId, canvasId),
        eq(taskCanvases.userId, userId),
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
      ),
    )
    .orderBy(asc(taskCanvases.createdAt));
  return rows
    .map((t) => ({
      ...t,
      isDone: t.status === "DONE" || t.status === "CANCELLED",
    }))
    .sort((a, b) => Number(a.isDone) - Number(b.isDone));
}

/** The canvases linked to a task. One in Trash is left out and comes back with Restore; an archived one is marked. */
export async function listLinkedCanvases(
  userId: string,
  taskId: string,
): Promise<LinkedCanvasDTO[]> {
  const rows = await db
    .select({
      id: canvases.id,
      title: canvases.title,
      emoji: canvases.emoji,
      kind: canvases.kind,
      archivedAt: canvases.archivedAt,
    })
    .from(taskCanvases)
    .innerJoin(canvases, eq(canvases.id, taskCanvases.canvasId))
    .where(
      and(
        eq(taskCanvases.taskId, taskId),
        eq(taskCanvases.userId, userId),
        eq(canvases.userId, userId),
        isNull(canvases.deletedAt),
      ),
    )
    .orderBy(asc(taskCanvases.createdAt));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    kind: r.kind as CanvasKind,
    archived: r.archivedAt !== null,
  }));
}

function likeTerm(query: string): string {
  return query.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Candidates for "Link a task" on a canvas: the person's open tasks, matched by title (up to 20). */
export async function searchTasksToLinkToCanvas(
  userId: string,
  query: string,
  limit = 20,
): Promise<CanvasTaskDTO[]> {
  const term = likeTerm(query);
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      emoji: tasks.emoji,
      status: tasks.status,
      dueDate: tasks.dueDate,
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAt),
        isNull(tasks.archivedAt),
        isNull(tasks.parentTaskId),
        inArray(tasks.status, ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"]),
        term ? sql`${tasks.title} ilike ${`%${term}%`}` : undefined,
      ),
    )
    .orderBy(desc(tasks.updatedAt))
    .limit(limit);
  return rows.map((t) => ({ ...t, isDone: false }));
}

/** Candidates for "Link a canvas" on a task: the person's live canvases (up to 20). */
export async function searchCanvasesToLink(
  userId: string,
  query: string,
  limit = 20,
): Promise<LinkedCanvasDTO[]> {
  const term = likeTerm(query);
  const rows = await db
    .select({
      id: canvases.id,
      title: canvases.title,
      emoji: canvases.emoji,
      kind: canvases.kind,
      archivedAt: canvases.archivedAt,
    })
    .from(canvases)
    .where(
      and(
        live(userId),
        isNull(canvases.archivedAt),
        term ? sql`${canvases.title} ilike ${`%${term}%`}` : undefined,
      ),
    )
    .orderBy(desc(canvases.updatedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    kind: r.kind as CanvasKind,
    archived: false,
  }));
}

/** The title and in-app address of one of the person's own notes, tasks or projects, for a card. */
export async function getCardTarget(
  userId: string,
  type: "note" | "task" | "project",
  id: string,
): Promise<CardTargetDTO | null> {
  if (type === "note") {
    const [row] = await db
      .select({ id: notes.id, title: notes.title, emoji: notes.emoji })
      .from(notes)
      .where(and(eq(notes.id, id), eq(notes.userId, userId), isNull(notes.deletedAt)))
      .limit(1);
    return row
      ? {
          type,
          id: row.id,
          title: row.title || "Untitled",
          emoji: row.emoji,
          href: `/notes/${row.id}`,
        }
      : null;
  }
  if (type === "task") {
    const [row] = await db
      .select({ id: tasks.id, title: tasks.title, emoji: tasks.emoji })
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
      .limit(1);
    return row
      ? { type, id: row.id, title: row.title, emoji: row.emoji, href: `/tasks?task=${row.id}` }
      : null;
  }
  const [row] = await db
    .select({ id: projects.id, title: projects.name })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);
  return row
    ? { type, id: row.id, title: row.title, emoji: null, href: `/projects/${row.id}` }
    : null;
}
