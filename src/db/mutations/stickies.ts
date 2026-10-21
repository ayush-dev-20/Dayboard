import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "@/db/executor";
import { tasks } from "@/db/schema";
import {
  duplicateStickies,
  readStickies,
  splitStickyText,
  STICKY_LIMITS,
  StickyError,
  withStickyIds,
  type StickyNote,
} from "@/lib/canvas/sticky";
import type { Scene } from "@/lib/canvas/types";
import type { TiptapDoc } from "@/lib/editor/types";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { logTaskUpserts } from "@/lib/sync/change-log";
import { orderAtBottom } from "@/lib/tasks/ordering";

// Keeping the sticky notes of a drawing and their tasks equal (V3 feature 01 §13.3). A sticky note is a rectangle on the
// drawing that carries a task (`tasks.kind = 'STICKY'`). The browser makes the note and a UUID for its task; this runs
// inside `saveCanvas` and `createCanvas`, in the same transaction, and makes the task match. Every write is a task write
// (`logTaskUpserts`), so versions, the change log and Trash behave as they do for any task.

export type StickyRemap = { element: string; id: string };

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

function words(text: string) {
  try {
    return splitStickyText(text);
  } catch (error) {
    if (error instanceof StickyError) {
      throw new AppError("VALIDATION_ERROR", error.message, {
        fieldErrors: { scene: error.message },
      });
    }
    throw error;
  }
}

/**
 * Makes the tasks of the drawing's sticky notes match the scene about to be saved, and returns the scene to store (a note
 * whose task id belongs to something else is given a fresh task, so the scene is rewritten) with the rewrites.
 */
export async function syncStickies(
  tx: Tx,
  userId: string,
  canvas: { id: string; projectId: string | null },
  scene: Scene,
  previous: Scene | null,
): Promise<{ scene: Scene; remap: StickyRemap[] }> {
  const notes = readStickies(scene.elements as never);
  if (notes.length > STICKY_LIMITS.perCanvas) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      `A canvas can hold ${STICKY_LIMITS.perCanvas} sticky notes. Delete some to add more.`,
    );
  }

  // A plain drawing (no notes now, none before) has nothing to keep equal.
  if (notes.length === 0 && !hasStickies(previous)) return { scene, remap: [] };

  // Notes sharing one task id (a duplicate or a paste): the first keeps it, every later one gets a task of its own.
  const remapIds = new Map<string, string>();
  for (const note of duplicateStickies(notes)) remapIds.set(note.elementId, uuidv7());

  const rows =
    notes.length === 0
      ? []
      : await tx
          .select({
            id: tasks.id,
            userId: tasks.userId,
            kind: tasks.kind,
            canvasId: tasks.stickyCanvasId,
            tone: tasks.stickyTone,
            deletedAt: tasks.deletedAt,
          })
          .from(tasks)
          .where(inArray(tasks.id, [...new Set(notes.map((n) => n.id))]));
  const byId = new Map(rows.map((r) => [r.id, r]));

  // A task id that exists but is not a note of this drawing of this person (pasted from another canvas, or someone else's
  // id): the note gets a fresh task. Nothing about the other row is read or changed.
  for (const note of notes) {
    if (remapIds.has(note.elementId)) continue;
    const row = byId.get(note.id);
    if (row && !(row.userId === userId && row.kind === "STICKY" && row.canvasId === canvas.id)) {
      remapIds.set(note.elementId, uuidv7());
    }
  }

  const ids = new Map(notes.map((n) => [n.elementId, remapIds.get(n.elementId) ?? n.id]));
  const before = new Map(
    readStickies((previous?.elements ?? []) as never).map((n) => [n.id, n] as const),
  );

  const now = new Date();
  const fresh: StickyNote[] = [];
  const touched: string[] = [];

  for (const note of notes) {
    const id = ids.get(note.elementId)!;
    const row = remapIds.has(note.elementId) ? undefined : byId.get(id);
    if (!row) {
      fresh.push({ ...note, id });
      continue;
    }
    const patch: Partial<typeof tasks.$inferInsert> = {};
    const earlier = before.get(id);
    // Only words typed on the drawing count: a stale scene never overwrites a task that was edited elsewhere.
    if (earlier && earlier.text !== note.text) {
      const { title, description } = words(note.text);
      patch.title = title;
      patch.descriptionJson = descriptionDoc(description);
      patch.descriptionText = description;
    }
    if (row.tone !== note.tone) patch.stickyTone = note.tone;
    // Back on the drawing after it was removed (Undo, or a restore): the task comes back too, unless the drawing already
    // had it, which means the task was deleted elsewhere and the page will take the note off.
    if (row.deletedAt && !earlier) patch.deletedAt = null;
    if (Object.keys(patch).length > 0) {
      await tx
        .update(tasks)
        .set(patch)
        .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
      touched.push(id);
    }
  }

  if (fresh.length > 0) {
    const [top] = await tx
      .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), eq(tasks.stickyCanvasId, canvas.id)));
    let order = orderAtBottom(top?.max ?? null);
    const created = await tx
      .insert(tasks)
      .values(
        fresh.map((note) => {
          const { title, description } = words(note.text);
          const row = {
            id: note.id,
            userId,
            projectId: canvas.projectId,
            kind: "STICKY",
            stickyCanvasId: canvas.id,
            stickyTone: note.tone,
            title,
            descriptionJson: descriptionDoc(description),
            descriptionText: description,
            sortOrder: order,
          };
          order += 1024;
          return row;
        }),
      )
      .returning({ id: tasks.id });
    await logTaskUpserts(
      tx,
      userId,
      created.map((c) => c.id),
      { bump: false },
    );
  }

  // A note taken off the drawing sends its task to Trash (so Undo or a restore can bring it back).
  const live = new Set(ids.values());
  const gone = await tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        eq(tasks.stickyCanvasId, canvas.id),
        eq(tasks.kind, "STICKY"),
        isNull(tasks.deletedAt),
      ),
    );
  const removed = gone.map((g) => g.id).filter((id) => !live.has(id));
  if (removed.length > 0) {
    await tx
      .update(tasks)
      .set({ deletedAt: now })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, removed)));
    touched.push(...removed);
  }

  if (touched.length > 0) await logTaskUpserts(tx, userId, touched, { bump: true });

  if (remapIds.size === 0) return { scene, remap: [] };
  return {
    scene: { ...scene, elements: withStickyIds(scene.elements, remapIds) },
    remap: [...remapIds].map(([element, id]) => ({ element, id })),
  };
}

/** Whether a canvas's notes need no sync at all (no notes before, none now): the common case for a plain drawing. */
export function hasStickies(scene: Scene | null): boolean {
  return scene !== null && readStickies(scene.elements as never).length > 0;
}
