import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Executor } from "@/db/executor";
import { notes, projects, tags, tasks } from "@/db/schema";
import { AppError } from "@/lib/errors";

// "Both sides belong to the person" checks for anything that links one record to another (technical
// spec §7). Someone else's record, a trashed one and a missing one all give the same NOT_FOUND, so
// the answer never reveals that an id exists.

export async function assertOwnedProject(executor: Executor, userId: string, id: string) {
  const [row] = await executor
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, id), eq(projects.userId, userId), isNull(projects.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
}

export async function assertOwnedTask(executor: Executor, userId: string, id: string) {
  const [row] = await executor
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
}

export async function assertOwnedNote(executor: Executor, userId: string, id: string) {
  const [row] = await executor
    .select({ id: notes.id })
    .from(notes)
    .where(and(eq(notes.id, id), eq(notes.userId, userId), isNull(notes.deletedAt)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND");
}

/** Every id must be one of the person's tags; anything else (including a duplicate-free subset) is NOT_FOUND. */
export async function assertOwnedTags(executor: Executor, userId: string, ids: string[]) {
  if (ids.length === 0) return;
  const rows = await executor
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, ids)));
  if (rows.length !== new Set(ids).size) throw new AppError("NOT_FOUND");
}
