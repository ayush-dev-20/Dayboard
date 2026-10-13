import { addDays, daysBetween } from "@/lib/dates/calendar";
import { uuidv7 } from "@/lib/ids";
import type { SnapshotTask } from "@/lib/sync/snapshot";
import { orderAtTop } from "@/lib/tasks/ordering";
import { nextOccurrence } from "@/lib/tasks/recurrence";
import { statusPatch, UNCOMPLETE_STATUS, type TaskPriority } from "@/lib/tasks/status";
import { createTaskSchema, updateTaskSchema } from "@/lib/validations/tasks";
import type { LocalDatabase } from "../db";
import { appendOperation } from "../operations";

// Offline task commands (V2 feature 04 §3). Each one: validates with the same Zod schema as the server,
// computes the new state with the same pure logic the server uses (status, recurrence, ordering), then
// writes the row and its operation in one transaction. The server repeats the change on replay.

export type CommandContext = {
  db: LocalDatabase;
  deviceId: string;
  defaultPriority: TaskPriority;
  now?: () => Date;
};

/** A command the person should see the reason for. `code` says what to do about it. */
export class LocalCommandError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NEEDS_CONNECTION",
    message: string,
  ) {
    super(message);
    this.name = "LocalCommandError";
  }
}

const clock = (ctx: CommandContext) => (ctx.now ? ctx.now() : new Date());

async function liveTask(ctx: CommandContext, id: string): Promise<SnapshotTask> {
  const task = await ctx.db.tasks.get(id);
  if (!task || task.deletedAt) {
    throw new LocalCommandError("NOT_FOUND", "That task isn't here any more.");
  }
  return task;
}

/** A new task at the top of the list. Its id is made here, so the server is told the same one. */
export async function createTask(
  ctx: CommandContext,
  input: {
    title: string;
    dueDate?: string | null;
    projectId?: string | null;
    priority?: TaskPriority;
  },
): Promise<string> {
  const now = clock(ctx);
  const id = uuidv7(now.getTime());
  // Validated with the server's schema, so an offline create cannot be refused on replay.
  const values = createTaskSchema.parse({ ...input, id });

  await ctx.db.transaction("rw", ctx.db.tasks, ctx.db.operations, async () => {
    const top = (await ctx.db.tasks.toArray()).filter(
      (t) => t.parentTaskId === null && !t.deletedAt,
    );
    const minOrder = top.length ? Math.min(...top.map((t) => t.sortOrder)) : null;
    const stamp = now.toISOString();
    await ctx.db.tasks.add({
      id,
      projectId: values.projectId ?? null,
      parentTaskId: null,
      title: values.title,
      emoji: null,
      status: "PLANNED",
      priority: values.priority ?? ctx.defaultPriority,
      dueDate: values.dueDate ?? null,
      dueTime: null,
      startDate: null,
      startTime: null,
      recurrenceRule: null,
      recurrenceParentId: null,
      sortOrder: orderAtTop(minOrder),
      completedAt: null,
      archivedAt: null,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      // 0 means "made here, not on the server yet"; any server version is newer (ADR 0007).
      version: 0,
    });
    await appendOperation(ctx.db, {
      entityId: id,
      type: "task.create",
      payload: values,
      deviceId: ctx.deviceId,
      now,
    });
  });
  return id;
}

/**
 * Ticks a task off. A repeating task also gets its next occurrence, dated from the previous due date
 * (as the server does). Such a task with subtasks is refused offline: the server copies the subtasks,
 * and that copy is not made offline yet.
 */
export async function completeTask(ctx: CommandContext, id: string): Promise<void> {
  const now = clock(ctx);
  await ctx.db.transaction("rw", ctx.db.tasks, ctx.db.operations, async () => {
    const task = await liveTask(ctx, id);
    if (task.status === "DONE") return;

    const stamp = now.toISOString();
    const patch = statusPatch("DONE", now);
    let nextId: string | null = null;

    if (task.recurrenceRule && task.dueDate && !task.parentTaskId) {
      const children = await ctx.db.tasks
        .filter((t) => t.parentTaskId === id && !t.deletedAt)
        .count();
      if (children > 0) {
        throw new LocalCommandError(
          "NEEDS_CONNECTION",
          "A repeating task with subtasks can be completed when you're back online.",
        );
      }
      const nextDue = nextOccurrence(task.recurrenceRule, task.dueDate);
      const shift = daysBetween(task.dueDate, nextDue);
      nextId = uuidv7(now.getTime());
      await ctx.db.tasks.add({
        ...task,
        id: nextId,
        status: "PLANNED",
        completedAt: null,
        dueDate: nextDue,
        startDate: task.startDate ? addDays(task.startDate, shift) : null,
        recurrenceRule: task.recurrenceRule,
        recurrenceParentId: task.recurrenceParentId ?? task.id,
        createdAt: stamp,
        updatedAt: stamp,
        archivedAt: null,
        deletedAt: null,
        version: 0,
      });
    }

    await ctx.db.tasks.update(id, {
      status: patch.status,
      completedAt: patch.completedAt?.toISOString() ?? null,
      recurrenceRule: nextId ? null : task.recurrenceRule,
      updatedAt: stamp,
    });
    await appendOperation(ctx.db, {
      entityId: id,
      type: "task.complete",
      payload: nextId ? { nextOccurrenceId: nextId } : {},
      deviceId: ctx.deviceId,
      now,
    });
  });
}

/** Takes a completed task back to open, as "tick it off again" does on the Tasks page. */
export async function reopenTask(ctx: CommandContext, id: string): Promise<void> {
  const now = clock(ctx);
  await ctx.db.transaction("rw", ctx.db.tasks, ctx.db.operations, async () => {
    await liveTask(ctx, id);
    await ctx.db.tasks.update(id, {
      status: UNCOMPLETE_STATUS,
      completedAt: null,
      updatedAt: now.toISOString(),
    });
    await appendOperation(ctx.db, {
      entityId: id,
      type: "task.reopen",
      payload: {},
      deviceId: ctx.deviceId,
      now,
    });
  });
}

/** Moves a task to another day, or clears its date (and its time with it). */
export async function rescheduleTask(
  ctx: CommandContext,
  id: string,
  dueDate: string | null,
): Promise<void> {
  const now = clock(ctx);
  const values = updateTaskSchema.parse({
    id,
    dueDate,
    ...(dueDate === null ? { dueTime: null } : {}),
  });
  await ctx.db.transaction("rw", ctx.db.tasks, ctx.db.operations, async () => {
    const task = await liveTask(ctx, id);
    const changes: Partial<SnapshotTask> = { dueDate, updatedAt: now.toISOString() };
    if (dueDate === null) changes.dueTime = null;
    await ctx.db.tasks.update(task.id, changes);
    await appendOperation(ctx.db, {
      entityId: id,
      type: "task.update",
      payload: { dueDate: values.dueDate ?? null, ...(dueDate === null ? { dueTime: null } : {}) },
      deviceId: ctx.deviceId,
      now,
    });
  });
}

/** Changes a task's title. */
export async function renameTask(ctx: CommandContext, id: string, title: string): Promise<void> {
  const now = clock(ctx);
  const values = updateTaskSchema.parse({ id, title });
  await ctx.db.transaction("rw", ctx.db.tasks, ctx.db.operations, async () => {
    const task = await liveTask(ctx, id);
    await ctx.db.tasks.update(task.id, {
      title: values.title ?? task.title,
      updatedAt: now.toISOString(),
    });
    await appendOperation(ctx.db, {
      entityId: id,
      type: "task.update",
      payload: { title: values.title },
      deviceId: ctx.deviceId,
      now,
    });
  });
}
