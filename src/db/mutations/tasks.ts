import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { inTransaction, type Executor, type Tx } from "@/db/executor";
import { assertOwnedNote, assertOwnedProject } from "@/db/mutations/guards";
import { projectDoc, syncNoteLinks } from "@/db/mutations/note-links";
import { taskMetaFor } from "@/db/queries/meta";
import { inboxItems, taskNotes, tasks, type NewTask, type Task } from "@/db/schema";
import { addDays, daysBetween } from "@/lib/dates/calendar";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { isEmptyDoc } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";
import { toTaskDTO, type TaskDTO } from "@/lib/tasks/dto";
import { orderAtBottom, orderAtTop, orderBetween, renumber } from "@/lib/tasks/ordering";
import { nextOccurrence } from "@/lib/tasks/recurrence";
import {
  statusAfterUndo,
  statusPatch,
  UNCOMPLETE_STATUS,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/status";
import { checkSubtaskParent } from "@/lib/tasks/subtasks";
import type {
  CreateTaskInput,
  CreateTasksBatchInput,
  UpdateTaskInput,
} from "@/lib/validations/tasks";

// Every function here takes the signed-in person's id first and puts it in every WHERE clause.
// A task that exists but belongs to someone else behaves exactly like one that doesn't exist.

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(tasks.id, id),
    eq(tasks.userId, userId),
    includeDeleted ? undefined : isNull(tasks.deletedAt),
  );
}

async function loadOwned(executor: Executor, userId: string, id: string, includeDeleted = false) {
  const [row] = await executor
    .select()
    .from(tasks)
    .where(owned(userId, id, includeDeleted))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

async function counts(executor: Executor, id: string) {
  const [row] = await executor
    .select({
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${tasks.status} = 'DONE')::int`,
    })
    .from(tasks)
    .where(and(eq(tasks.parentTaskId, id), isNull(tasks.deletedAt)));
  return { total: row?.total ?? 0, done: row?.done ?? 0 };
}

async function dto(executor: Executor, task: Task): Promise<TaskDTO> {
  const [meta, total] = await Promise.all([
    taskMetaFor(executor, task.userId, [{ id: task.id, projectId: task.projectId }]),
    task.parentTaskId ? undefined : counts(executor, task.id),
  ]);
  return toTaskDTO(task, total, meta.get(task.id));
}

async function topOrder(executor: Executor, userId: string): Promise<number> {
  const [row] = await executor
    .select({ min: sql<number | null>`min(${tasks.sortOrder})` })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.parentTaskId), isNull(tasks.deletedAt)));
  return orderAtTop(row?.min ?? null);
}

async function bottomOrder(executor: Executor, userId: string, parentId: string): Promise<number> {
  const [row] = await executor
    .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
    .from(tasks)
    .where(
      and(eq(tasks.userId, userId), eq(tasks.parentTaskId, parentId), isNull(tasks.deletedAt)),
    );
  return orderAtBottom(row?.max ?? null);
}

export async function createTask(
  userId: string,
  input: CreateTaskInput,
  defaults: { priority: TaskPriority },
  outer?: Tx,
): Promise<TaskDTO> {
  return inTransaction(outer, async (tx) => {
    if (input.parentTaskId) {
      const [parent] = await tx
        .select({ id: tasks.id, userId: tasks.userId, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .where(owned(userId, input.parentTaskId))
        .limit(1);
      const check = checkSubtaskParent(parent ?? null, { userId });
      if (!check.ok) {
        throw check.reason === "NOT_FOUND"
          ? new AppError("NOT_FOUND")
          : new AppError("VALIDATION_ERROR", "Subtasks can't have subtasks.");
      }
    }

    const sortOrder = input.parentTaskId
      ? await bottomOrder(tx, userId, input.parentTaskId)
      : await topOrder(tx, userId);

    // A subtask always follows its parent's project; anything else must be one of the person's own.
    let projectId: string | null = input.projectId ?? null;
    if (input.parentTaskId) {
      const [parent] = await tx
        .select({ projectId: tasks.projectId })
        .from(tasks)
        .where(owned(userId, input.parentTaskId))
        .limit(1);
      projectId = parent?.projectId ?? null;
    } else if (projectId) {
      await assertOwnedProject(tx, userId, projectId);
    }

    const [created] = await tx
      .insert(tasks)
      .values({
        userId,
        projectId,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        emoji: input.emoji ?? null,
        status: input.status ?? "PLANNED",
        priority: input.priority ?? defaults.priority,
        dueDate: input.dueDate ?? null,
        dueTime: input.dueTime ?? null,
        startDate: input.startDate ?? null,
        startTime: input.startTime ?? null,
        recurrenceRule: input.recurrenceRule ?? null,
        completedAt: input.status === "DONE" ? new Date() : null,
        sortOrder,
      })
      .returning();
    if (!created) throw new AppError("INTERNAL_ERROR");
    return dto(tx, created);
  });
}

/**
 * Creates several tasks in one transaction: all of them or none. Each goes through `createTask`, so
 * ownership, the subtask rules and ordering are the same as creating them one by one. With
 * `linkNoteId`, every new task is also linked to that note.
 */
export async function createTasksBatch(
  userId: string,
  input: CreateTasksBatchInput,
  defaults: { priority: TaskPriority },
): Promise<TaskDTO[]> {
  return db.transaction(async (tx) => {
    if (input.linkNoteId) await assertOwnedNote(tx, userId, input.linkNoteId);
    const created: TaskDTO[] = [];
    for (const item of input.items) {
      const task = await createTask(
        userId,
        {
          title: item.title,
          dueDate: item.dueDate ?? null,
          parentTaskId: input.parentTaskId ?? null,
          projectId: input.parentTaskId ? null : (input.projectId ?? null),
        },
        defaults,
        tx,
      );
      if (input.linkNoteId) {
        await tx.insert(taskNotes).values({ taskId: task.id, noteId: input.linkNoteId, userId });
      }
      created.push(task);
    }

    if (input.fromInboxItemId) {
      const [item] = await tx
        .update(inboxItems)
        .set({
          status: "CONVERTED",
          convertedAt: new Date(),
          convertedRefs: created.map((t) => ({ type: "task" as const, id: t.id })),
        })
        .where(
          and(
            eq(inboxItems.id, input.fromInboxItemId),
            eq(inboxItems.userId, userId),
            eq(inboxItems.status, "OPEN"),
            isNull(inboxItems.deletedAt),
          ),
        )
        .returning({ id: inboxItems.id });
      if (!item) throw new AppError("NOT_FOUND");
    }
    return created;
  });
}

export async function updateTask(userId: string, input: UpdateTaskInput): Promise<TaskDTO> {
  return db.transaction(async (tx) => {
    const task = await loadOwned(tx, userId, input.id);
    const patch: Partial<NewTask> = {};

    if (input.title !== undefined) patch.title = input.title;
    if (input.emoji !== undefined) patch.emoji = input.emoji;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.dueDate !== undefined) patch.dueDate = input.dueDate;
    if (input.dueTime !== undefined) patch.dueTime = input.dueTime;
    if (input.startDate !== undefined) patch.startDate = input.startDate;
    if (input.startTime !== undefined) patch.startTime = input.startTime;
    if (input.recurrenceRule !== undefined) patch.recurrenceRule = input.recurrenceRule;

    // Removing a date removes what depends on it: its time, and (for a due date) the repeat.
    if (input.dueDate === null) {
      patch.dueTime = null;
      if (input.recurrenceRule === undefined) patch.recurrenceRule = null;
    }
    if (input.startDate === null) patch.startTime = null;

    const merged = { ...task, ...patch };
    if (merged.dueTime && !merged.dueDate) {
      throw new AppError("VALIDATION_ERROR", "Choose a due date first.", {
        fieldErrors: { dueTime: "Choose a due date first." },
      });
    }
    if (merged.startTime && !merged.startDate) {
      throw new AppError("VALIDATION_ERROR", "Choose a start date first.", {
        fieldErrors: { startTime: "Choose a start date first." },
      });
    }
    if (patch.recurrenceRule) {
      if (!merged.dueDate) {
        throw new AppError("VALIDATION_ERROR", "A repeating task needs a due date.", {
          fieldErrors: { recurrenceRule: "A repeating task needs a due date." },
        });
      }
      if (task.parentTaskId) {
        throw new AppError("VALIDATION_ERROR", "Subtasks can't repeat.", {
          fieldErrors: { recurrenceRule: "Subtasks can't repeat." },
        });
      }
    }

    if (Object.keys(patch).length === 0) return dto(tx, task);

    const [updated] = await tx.update(tasks).set(patch).where(owned(userId, input.id)).returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return dto(tx, updated);
  });
}

export async function updateTaskDescription(
  userId: string,
  id: string,
  doc: TiptapDoc | null,
  executor: Executor = db,
): Promise<{ updatedAt: string }> {
  // An empty editor is stored as null. The plain-text projection is always built here, with the
  // titles of any notes the text links to, and the "Linked from" rows are rebuilt with it.
  const empty = doc === null || isEmptyDoc(doc);
  return inTransaction(executor === db ? undefined : (executor as Tx), async (tx) => {
    const projected = empty ? null : await projectDoc(tx, userId, doc);
    const [updated] = await tx
      .update(tasks)
      .set({
        descriptionJson: empty ? null : doc,
        descriptionText: projected ? projected.text : null,
      })
      .where(owned(userId, id))
      .returning({ updatedAt: tasks.updatedAt });
    if (!updated) throw new AppError("NOT_FOUND");
    await syncNoteLinks(tx, userId, { type: "TASK", id }, empty ? null : doc, projected?.titles);
    return { updatedAt: updated.updatedAt.toISOString() };
  });
}

export type CompleteResult = {
  task: TaskDTO;
  previousStatus: TaskStatus;
  nextOccurrenceId: string | null;
  openSubtasks: number;
};

/**
 * Marks a task done. A repeating task also gets its next occurrence in the same transaction,
 * dated from the previous *due date* (not today), so finishing late never shifts the schedule.
 */
export async function completeTask(
  userId: string,
  id: string,
  now: Date = new Date(),
): Promise<CompleteResult> {
  return db.transaction(async (tx) => {
    const [task] = await tx.select().from(tasks).where(owned(userId, id)).for("update").limit(1);
    if (!task) throw new AppError("NOT_FOUND");

    if (task.status === "DONE") {
      return {
        task: await dto(tx, task),
        previousStatus: "DONE",
        nextOccurrenceId: null,
        openSubtasks: 0,
      };
    }

    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(
        and(
          eq(tasks.parentTaskId, id),
          isNull(tasks.deletedAt),
          sql`${tasks.status} not in ('DONE','CANCELLED')`,
        ),
      );

    const patch: Partial<NewTask> = { ...statusPatch("DONE", now) };
    let nextOccurrenceId: string | null = null;

    if (task.recurrenceRule && task.dueDate && !task.parentTaskId) {
      const nextDue = nextOccurrence(task.recurrenceRule, task.dueDate);
      const shiftDays = daysBetween(task.dueDate, nextDue);
      nextOccurrenceId = uuidv7();

      await tx.insert(tasks).values({
        id: nextOccurrenceId,
        userId,
        projectId: task.projectId,
        title: task.title,
        emoji: task.emoji,
        descriptionJson: task.descriptionJson,
        descriptionText: task.descriptionText,
        status: "PLANNED",
        priority: task.priority,
        dueDate: nextDue,
        dueTime: task.dueTime,
        startDate: task.startDate ? addDays(task.startDate, shiftDays) : null,
        startTime: task.startTime,
        recurrenceRule: task.recurrenceRule,
        recurrenceParentId: task.recurrenceParentId ?? task.id,
        sortOrder: task.sortOrder,
        // Equal on purpose: "created == updated" is how undo knows nobody has edited it yet.
        createdAt: now,
        updatedAt: now,
      });
      // The copy of the description carries its note links too.
      await syncNoteLinks(tx, userId, { type: "TASK", id: nextOccurrenceId }, task.descriptionJson);

      const subtasks = await tx
        .select()
        .from(tasks)
        .where(and(eq(tasks.parentTaskId, id), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
      if (subtasks.length > 0) {
        const copies = await tx
          .insert(tasks)
          .values(
            subtasks.map((s) => ({
              userId,
              parentTaskId: nextOccurrenceId,
              title: s.title,
              emoji: s.emoji,
              descriptionJson: s.descriptionJson,
              descriptionText: s.descriptionText,
              status: "PLANNED" as const,
              priority: s.priority,
              dueDate: s.dueDate ? addDays(s.dueDate, shiftDays) : null,
              dueTime: s.dueTime,
              startDate: s.startDate ? addDays(s.startDate, shiftDays) : null,
              startTime: s.startTime,
              sortOrder: s.sortOrder,
              createdAt: now,
              updatedAt: now,
            })),
          )
          .returning({ id: tasks.id });
        for (const [index, copy] of copies.entries()) {
          await syncNoteLinks(
            tx,
            userId,
            { type: "TASK", id: copy.id },
            subtasks[index]?.descriptionJson ?? null,
          );
        }
      }

      // The finished one becomes a plain completed task; the new one carries the repeat.
      patch.recurrenceRule = null;
    }

    const [updated] = await tx.update(tasks).set(patch).where(owned(userId, id)).returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return {
      task: await dto(tx, updated),
      previousStatus: task.status,
      nextOccurrenceId,
      openSubtasks: open?.n ?? 0,
    };
  });
}

/**
 * Reverses `completeTask`. The next occurrence is removed only if nobody has touched it since,
 * and the repeat goes back onto the original.
 */
export async function undoCompleteTask(
  userId: string,
  input: { id: string; previousStatus: TaskStatus; nextOccurrenceId?: string | null },
): Promise<{ task: TaskDTO; removedOccurrence: boolean }> {
  return db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(owned(userId, input.id))
      .for("update")
      .limit(1);
    if (!task) throw new AppError("NOT_FOUND");
    if (task.status !== "DONE") return { task: await dto(tx, task), removedOccurrence: false };

    const patch: Partial<NewTask> = statusPatch(statusAfterUndo(input.previousStatus), new Date());
    let removed = false;

    if (input.nextOccurrenceId) {
      const [next] = await tx
        .select()
        .from(tasks)
        .where(owned(userId, input.nextOccurrenceId))
        .for("update")
        .limit(1);
      const untouched =
        next && next.status !== "DONE" && next.updatedAt.getTime() === next.createdAt.getTime();
      if (next && untouched) {
        const [edited] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(tasks)
          .where(
            and(eq(tasks.parentTaskId, next.id), sql`${tasks.updatedAt} <> ${tasks.createdAt}`),
          );
        if ((edited?.n ?? 0) === 0) {
          patch.recurrenceRule = next.recurrenceRule;
          await tx.delete(tasks).where(owned(userId, next.id, true));
          removed = true;
        }
      }
    }

    const [updated] = await tx.update(tasks).set(patch).where(owned(userId, input.id)).returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return { task: await dto(tx, updated), removedOccurrence: removed };
  });
}

/** Any status change. Finishing goes through `completeTask` so repeating tasks roll forward. */
export async function setTaskStatus(
  userId: string,
  id: string,
  status: TaskStatus,
): Promise<TaskDTO> {
  if (status === "DONE") return (await completeTask(userId, id)).task;

  return db.transaction(async (tx) => {
    await loadOwned(tx, userId, id);
    const [updated] = await tx
      .update(tasks)
      .set(statusPatch(status, new Date()))
      .where(owned(userId, id))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return dto(tx, updated);
  });
}

/** Ticking a completed task off the Completed list. */
export async function uncompleteTask(userId: string, id: string): Promise<TaskDTO> {
  return setTaskStatus(userId, id, UNCOMPLETE_STATUS);
}

/**
 * `beforeId` is the neighbour that will sit just above the moved task, `afterId` the one just
 * below. The moved task gets the midpoint of their orders; if there is no room left the whole
 * list is renumbered.
 */
export async function reorderTask(
  userId: string,
  input: { id: string; beforeId?: string | null; afterId?: string | null },
): Promise<{ sortOrder: number }> {
  return db.transaction(async (tx) => {
    const moved = await loadOwned(tx, userId, input.id);
    const siblings = and(
      eq(tasks.userId, userId),
      isNull(tasks.deletedAt),
      moved.parentTaskId ? eq(tasks.parentTaskId, moved.parentTaskId) : isNull(tasks.parentTaskId),
    );

    async function neighbour(neighbourId: string | null | undefined) {
      if (!neighbourId) return null;
      if (neighbourId === input.id)
        throw new AppError("VALIDATION_ERROR", "A task can't go next to itself.");
      const [row] = await tx
        .select({ id: tasks.id, sortOrder: tasks.sortOrder })
        .from(tasks)
        .where(and(siblings, eq(tasks.id, neighbourId)))
        .limit(1);
      if (!row) throw new AppError("NOT_FOUND");
      return row;
    }

    const above = await neighbour(input.beforeId);
    const below = await neighbour(input.afterId);
    const { order, needsRenumber } = orderBetween(
      above?.sortOrder ?? null,
      below?.sortOrder ?? null,
    );

    if (!needsRenumber) {
      await tx.update(tasks).set({ sortOrder: order }).where(owned(userId, input.id));
      return { sortOrder: order };
    }

    const others = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(siblings, ne(tasks.id, input.id)))
      .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
    const ids = others.map((r) => r.id);
    const position = above ? ids.indexOf(above.id) + 1 : below ? ids.indexOf(below.id) : ids.length;
    ids.splice(position, 0, input.id);

    const fresh = renumber(ids);
    for (const [taskId, sortOrder] of fresh) {
      await tx.update(tasks).set({ sortOrder }).where(owned(userId, taskId));
    }
    return { sortOrder: fresh.get(input.id) as number };
  });
}

export async function archiveTask(userId: string, id: string, archived: boolean): Promise<TaskDTO> {
  return db.transaction(async (tx) => {
    await loadOwned(tx, userId, id);
    const [updated] = await tx
      .update(tasks)
      .set({ archivedAt: archived ? new Date() : null })
      .where(owned(userId, id))
      .returning();
    if (!updated) throw new AppError("NOT_FOUND");
    return dto(tx, updated);
  });
}

/** Moves a task, and its subtasks, to Trash. All share one timestamp so restore can find them. */
export async function deleteTask(userId: string, id: string): Promise<{ deletedAt: string }> {
  return db.transaction(async (tx) => {
    await loadOwned(tx, userId, id);
    const now = new Date();
    await tx.update(tasks).set({ deletedAt: now }).where(owned(userId, id));
    await tx
      .update(tasks)
      .set({ deletedAt: now })
      .where(and(eq(tasks.parentTaskId, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)));
    return { deletedAt: now.toISOString() };
  });
}

/** Brings back a task and the subtasks that were deleted with it. */
export async function restoreTask(userId: string, id: string): Promise<TaskDTO> {
  return db.transaction(async (tx) => {
    const task = await loadOwned(tx, userId, id, true);
    if (!task.deletedAt) throw new AppError("NOT_FOUND");

    if (task.parentTaskId) {
      const [parent] = await tx
        .select({ deletedAt: tasks.deletedAt })
        .from(tasks)
        .where(owned(userId, task.parentTaskId, true))
        .limit(1);
      if (!parent || parent.deletedAt) {
        throw new AppError("CONFLICT", "Restore the task it belongs to first.");
      }
    }

    await tx
      .update(tasks)
      .set({ deletedAt: null })
      .where(owned(userId, id, true));
    await tx
      .update(tasks)
      .set({ deletedAt: null })
      .where(
        and(
          eq(tasks.parentTaskId, id),
          eq(tasks.userId, userId),
          eq(tasks.deletedAt, task.deletedAt),
        ),
      );

    const [restored] = await tx.select().from(tasks).where(owned(userId, id)).limit(1);
    if (!restored) throw new AppError("NOT_FOUND");
    return dto(tx, restored);
  });
}

/** Only from Trash (feature 04): a task that isn't deleted can't be permanently deleted. */
export async function permanentlyDeleteTask(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const task = await loadOwned(tx, userId, id, true);
    if (!task.deletedAt) throw new AppError("CONFLICT", "Move it to Trash first.");
    await tx.delete(tasks).where(owned(userId, id, true)); // subtasks cascade
  });
}
