import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Executor, type Tx } from "@/db/executor";
import { assertOwnedNote, assertOwnedProject, assertOwnedTask } from "@/db/mutations/guards";
import { rejectReusedId } from "@/db/mutations/reused-id";
import { auditLog, canvases, taskCanvases } from "@/db/schema";
import { projectScene, sanitizeScene, SceneError } from "@/lib/canvas/schema";
import { CANVAS_LIMIT, EMPTY_SCENE, type Scene } from "@/lib/canvas/types";
import { describeDiagramApplied } from "@/lib/canvas/audit";
import { describeRefineApplied } from "@/lib/canvas/refine";
import type { CanvasSaveResult } from "@/lib/canvas/dto";
import type { ProposalInput, RefineProposalInput } from "@/lib/validations/canvases";
import { AppError } from "@/lib/errors";

// Writes of canvases (V3 feature 01 §6). Every function takes the signed-in person's id first and puts it in every
// WHERE clause: someone else's canvas behaves exactly like one that doesn't exist. A scene reaches the database only
// through `sanitizeScene`, and its search text and element count are always built here.

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(canvases.id, id),
    eq(canvases.userId, userId),
    includeDeleted ? undefined : isNull(canvases.deletedAt),
  );
}

/** A scene problem becomes a plain validation error, not a server error. */
function checkedScene(input: unknown): Scene {
  try {
    return sanitizeScene(input);
  } catch (error) {
    if (error instanceof SceneError) {
      throw new AppError("VALIDATION_ERROR", error.message, {
        fieldErrors: { scene: error.message },
      });
    }
    throw error;
  }
}

async function assertUnderLimit(executor: Executor, userId: string) {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(canvases)
    .where(and(eq(canvases.userId, userId), isNull(canvases.deletedAt)));
  if ((row?.n ?? 0) >= CANVAS_LIMIT) {
    throw new AppError(
      "QUOTA_EXCEEDED",
      `You can keep ${CANVAS_LIMIT} canvases. Archive or delete one to make another.`,
    );
  }
}

export type CreateCanvasInput = {
  title?: string;
  emoji?: string | null;
  projectId?: string | null;
  scene?: unknown;
  /** An AI diagram: applies once, with an audit row of counts (never a label). */
  proposal?: ProposalInput;
};

export async function createCanvas(
  userId: string,
  input: CreateCanvasInput,
  outer?: Tx,
): Promise<{ id: string; version: number }> {
  return inTransaction(outer, async (tx) => {
    if (input.projectId) await assertOwnedProject(tx, userId, input.projectId);
    await assertUnderLimit(tx, userId);

    const scene = input.scene === undefined ? EMPTY_SCENE : checkedScene(input.scene);
    const title = input.title ?? "";
    const { text, elementCount } = projectScene(title, scene);
    const [created] = await tx
      .insert(canvases)
      .values({
        userId,
        projectId: input.projectId ?? null,
        title,
        emoji: input.emoji ?? null,
        kind: "DRAWING",
        sceneJson: scene,
        sceneText: text,
        elementCount,
      })
      .returning({ id: canvases.id, version: canvases.version });
    if (!created) throw new AppError("INTERNAL_ERROR");

    // An AI diagram applies once: the audit row's (user, proposal) key is unique, so a second apply is a CONFLICT and
    // the canvas above rolls back with it. The row holds counts only, never a label or the prompt.
    if (input.proposal) await recordDiagram(tx, userId, created.id, input.proposal, "draw");
    return created;
  });
}

/**
 * One audit row for an AI diagram, keyed by the proposal so it applies once: a second apply is a CONFLICT and rolls back
 * with the write around it. The summary is built here from numbers; it never holds a title, a label or the prompt.
 */
async function recordDiagram(
  tx: Tx,
  userId: string,
  canvasId: string,
  proposal: ProposalInput,
  mode: "draw" | "add",
) {
  await rejectReusedId(async () => {
    await tx.insert(auditLog).values({
      userId,
      source: "CANVAS",
      action: mode === "draw" ? "canvas.draw" : "canvas.addDiagram",
      entityRefs: [{ type: "canvas", id: canvasId }],
      proposalId: proposal.id,
      summary: describeDiagramApplied(proposal, mode),
    });
  });
}

/** The same for a refine: keyed by the proposal, counts only. */
async function recordRefine(tx: Tx, userId: string, canvasId: string, refine: RefineProposalInput) {
  const { id, ...counts } = refine;
  await rejectReusedId(async () => {
    await tx.insert(auditLog).values({
      userId,
      source: "CANVAS",
      action: "canvas.refine",
      entityRefs: [{ type: "canvas", id: canvasId }],
      proposalId: id,
      summary: describeRefineApplied(counts),
    });
  });
}

async function conflictOrMissing(
  executor: Executor,
  userId: string,
  id: string,
): Promise<CanvasSaveResult> {
  const [current] = await executor
    .select({ version: canvases.version })
    .from(canvases)
    .where(owned(userId, id))
    .limit(1);
  if (!current) throw new AppError("NOT_FOUND");
  return { outcome: "conflict", version: current.version };
}

/**
 * Saves the scene (and optionally the title) only if the canvas is still at the version the page started from. The
 * search text and the element count are rebuilt here from the checked scene; the client never sends them.
 */
export async function saveCanvas(
  userId: string,
  input: {
    id: string;
    version: number;
    scene?: unknown;
    title?: string;
    proposal?: ProposalInput;
    refine?: RefineProposalInput;
  },
): Promise<CanvasSaveResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ title: canvases.title, sceneJson: canvases.sceneJson, kind: canvases.kind })
      .from(canvases)
      .where(owned(userId, input.id))
      .limit(1);
    if (!current) throw new AppError("NOT_FOUND");
    if (current.kind !== "DRAWING" && input.scene !== undefined) {
      throw new AppError("VALIDATION_ERROR", "That canvas has no drawing to save.");
    }

    const scene =
      input.scene === undefined ? (current.sceneJson as Scene) : checkedScene(input.scene);
    const title = input.title ?? current.title;
    const { text, elementCount } = projectScene(title, scene);
    const [row] = await tx
      .update(canvases)
      .set({
        sceneJson: scene,
        title,
        sceneText: text,
        elementCount,
        version: sql`${canvases.version} + 1`,
      })
      .where(and(owned(userId, input.id), eq(canvases.version, input.version)))
      .returning({ version: canvases.version, updatedAt: canvases.updatedAt });
    if (!row) return conflictOrMissing(tx, userId, input.id);
    // "Add to this canvas" applies an AI diagram once, with the same audit row as drawing a new one.
    if (input.proposal) await recordDiagram(tx, userId, input.id, input.proposal, "add");
    if (input.refine) await recordRefine(tx, userId, input.id, input.refine);
    return { outcome: "saved", version: row.version, updatedAt: row.updatedAt.toISOString() };
  });
}

/**
 * Title, emoji and project. A rename does not bump `version`, so it never makes an open drawing conflict with
 * itself; the search text is rebuilt from the stored scene.
 */
export async function updateCanvasMeta(
  userId: string,
  input: { id: string; title?: string; emoji?: string | null; projectId?: string | null },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ title: canvases.title, sceneJson: canvases.sceneJson })
      .from(canvases)
      .where(owned(userId, input.id))
      .limit(1);
    if (!current) throw new AppError("NOT_FOUND");
    if (input.projectId) await assertOwnedProject(tx, userId, input.projectId);

    const patch: Partial<typeof canvases.$inferInsert> = {};
    if (input.title !== undefined && input.title !== current.title) {
      patch.title = input.title;
      patch.sceneText = projectScene(input.title, current.sceneJson as Scene).text;
    }
    if (input.emoji !== undefined) patch.emoji = input.emoji;
    if (input.projectId !== undefined) patch.projectId = input.projectId;
    if (Object.keys(patch).length === 0) return;
    await tx.update(canvases).set(patch).where(owned(userId, input.id));
  });
}

export async function archiveCanvas(userId: string, id: string, archived: boolean): Promise<void> {
  const rows = await db
    .update(canvases)
    .set({ archivedAt: archived ? new Date() : null })
    .where(owned(userId, id))
    .returning({ id: canvases.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
}

/** To Trash. Links are kept, so Restore brings everything back. */
export async function deleteCanvas(userId: string, id: string): Promise<void> {
  const rows = await db
    .update(canvases)
    .set({ deletedAt: new Date() })
    .where(owned(userId, id))
    .returning({ id: canvases.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
}

export async function restoreCanvas(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ id: canvases.id, deletedAt: canvases.deletedAt })
      .from(canvases)
      .where(owned(userId, id, true))
      .limit(1);
    if (!row || !row.deletedAt) throw new AppError("NOT_FOUND");
    // Coming back counts toward the limit like a new one.
    await assertUnderLimit(tx, userId);
    await tx
      .update(canvases)
      .set({ deletedAt: null })
      .where(owned(userId, id, true));
  });
}

/** Deletes for good. The links go with it (cascade); cards on other drawings keep their snapshot title. */
export async function permanentlyDeleteCanvas(userId: string, id: string): Promise<void> {
  const rows = await db
    .delete(canvases)
    .where(owned(userId, id, true))
    .returning({ id: canvases.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
}

async function assertOwnedCanvas(executor: Executor, userId: string, id: string) {
  const [row] = await executor
    .select({ id: canvases.id })
    .from(canvases)
    .where(owned(userId, id))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
}

/** Both sides must be the person's and live, or this is NOT_FOUND. Linking twice is a no-op. */
export async function linkTaskCanvas(
  userId: string,
  taskId: string,
  canvasId: string,
  outer?: Tx,
): Promise<void> {
  await inTransaction(outer, async (tx) => {
    await assertOwnedTask(tx, userId, taskId);
    await assertOwnedCanvas(tx, userId, canvasId);
    await tx.insert(taskCanvases).values({ taskId, canvasId, userId }).onConflictDoNothing();
  });
}

/** Unlinking does not remove cards from the drawing. */
export async function unlinkTaskCanvas(
  userId: string,
  taskId: string,
  canvasId: string,
): Promise<void> {
  await db
    .delete(taskCanvases)
    .where(
      and(
        eq(taskCanvases.taskId, taskId),
        eq(taskCanvases.canvasId, canvasId),
        eq(taskCanvases.userId, userId),
      ),
    );
}

/** For a card on a drawing: the target must be the person's own. A task is also linked when a canvas is given. */
export async function assertCardTargetOwned(
  userId: string,
  type: "note" | "task" | "project",
  id: string,
): Promise<void> {
  if (type === "note") await assertOwnedNote(db, userId, id);
  else if (type === "task") await assertOwnedTask(db, userId, id);
  else await assertOwnedProject(db, userId, id);
}
