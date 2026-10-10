import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { assertOwnedNote } from "@/db/mutations/guards";
import { assignToProject } from "@/db/mutations/projects";
import { createTask, setTaskStatus, updateTask } from "@/db/mutations/tasks";
import { auditLog, taskNotes } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { TaskPriority } from "@/lib/tasks/status";
import type { ApplyProposalInput } from "@/lib/validations/assistant";
import { linkTaskNote } from "@/db/mutations/notes";

// Applying a proposal the person confirmed (V2 feature 11 §5). It goes through the same commands as
// everything else (`createTask`, `updateTask`, `setTaskStatus`, `assignToProject`, `linkTaskNote`), so
// ownership, ordering and the subtask rules are the same as doing it by hand, then writes one
// `audit_log` row. A proposal is applied once: its id is unique per person.

export type ApplyResult = {
  applied: number;
  failed: number;
  /** The tasks that were created (new tasks only), so the card can link to them. */
  createdIds: string[];
};

const KIND_ACTION = {
  createTasks: "tasks.create",
  updateTasks: "task.update",
  linkNotes: "taskNote.link",
} as const;

/** Counts and kinds only: never a title, a note's text or a prompt. */
function summaryFor(kind: ApplyProposalInput["kind"], applied: number, total: number): string {
  const part = applied === total ? `${applied}` : `${applied} of ${total}`;
  if (kind === "createTasks") return `Created ${part} ${total === 1 ? "task" : "tasks"}`;
  if (kind === "updateTasks") return `Updated ${part} ${total === 1 ? "task" : "tasks"}`;
  return `Linked ${part} ${total === 1 ? "note" : "notes"} to tasks`;
}

export async function applyProposal(
  userId: string,
  input: ApplyProposalInput,
  defaults: { priority: TaskPriority },
): Promise<ApplyResult> {
  // Claim the proposal id first: a second apply (a double click, a second tab) finds it taken.
  const [claim] = await db
    .insert(auditLog)
    .values({
      userId,
      source: "ASSISTANT",
      action: KIND_ACTION[input.kind],
      entityRefs: [],
      proposalId: input.proposalId,
      summary: "Applying a suggestion",
    })
    .onConflictDoNothing()
    .returning({ id: auditLog.id });
  if (!claim) throw new AppError("CONFLICT", "That suggestion was already applied.");

  const release = () => db.delete(auditLog).where(eq(auditLog.id, claim.id));
  let outcome: Outcome;
  try {
    outcome = await run(userId, input, defaults);
  } catch (error) {
    // Nothing was changed (creating is all-or-nothing), so the person may try again.
    if (!(error instanceof AppError)) logger.warn("applying a proposal failed", { error });
    await release().catch(() => undefined);
    throw error;
  }

  const total =
    input.kind === "createTasks"
      ? input.items.length
      : input.kind === "updateTasks"
        ? input.changes.length
        : input.links.length;
  if (outcome.applied === 0) {
    await release().catch(() => undefined);
    throw new AppError("VALIDATION_ERROR", "Couldn't apply that suggestion. Nothing was changed.");
  }
  await db
    .update(auditLog)
    .set({ entityRefs: outcome.refs, summary: summaryFor(input.kind, outcome.applied, total) })
    .where(eq(auditLog.id, claim.id));
  return {
    applied: outcome.applied,
    failed: total - outcome.applied,
    createdIds: outcome.createdIds,
  };
}

type Outcome = {
  applied: number;
  refs: { type: string; id: string }[];
  createdIds: string[];
};

async function run(
  userId: string,
  input: ApplyProposalInput,
  defaults: { priority: TaskPriority },
): Promise<Outcome> {
  if (input.kind === "createTasks") {
    // All of them or none: one transaction, each task through `createTask`.
    return db.transaction(async (tx) => {
      const refs: Outcome["refs"] = [];
      const createdIds: string[] = [];
      for (const item of input.items) {
        if (item.linkNoteId) await assertOwnedNote(tx, userId, item.linkNoteId);
        const task = await createTask(
          userId,
          {
            title: item.title,
            dueDate: item.dueDate ?? null,
            projectId: item.projectId ?? null,
            ...(item.priority ? { priority: item.priority } : {}),
          },
          defaults,
          tx,
        );
        createdIds.push(task.id);
        refs.push({ type: "task", id: task.id });
        if (item.linkNoteId) {
          await tx
            .insert(taskNotes)
            .values({ taskId: task.id, noteId: item.linkNoteId, userId })
            .onConflictDoNothing();
          refs.push({ type: "note", id: item.linkNoteId });
        }
      }
      return { applied: input.items.length, refs, createdIds };
    });
  }

  const outcome: Outcome = { applied: 0, refs: [], createdIds: [] };
  if (input.kind === "updateTasks") {
    for (const change of input.changes) {
      try {
        const { status, priority, dueDate, projectId } = change.set;
        if (priority !== undefined || dueDate !== undefined) {
          await updateTask(userId, {
            id: change.taskId,
            ...(priority !== undefined ? { priority } : {}),
            ...(dueDate !== undefined ? { dueDate } : {}),
          });
        }
        if (projectId !== undefined) {
          await assignToProject(userId, { itemType: "task", itemId: change.taskId, projectId });
        }
        if (status !== undefined) await setTaskStatus(userId, change.taskId, status);
        outcome.applied += 1;
        outcome.refs.push({ type: "task", id: change.taskId });
      } catch (error) {
        logger.warn("a proposed change could not be applied", { error });
      }
    }
    return outcome;
  }

  for (const link of input.links) {
    try {
      await linkTaskNote(userId, link.taskId, link.noteId);
      outcome.applied += 1;
      outcome.refs.push({ type: "task", id: link.taskId }, { type: "note", id: link.noteId });
    } catch (error) {
      logger.warn("a proposed link could not be made", { error });
    }
  }
  return outcome;
}
