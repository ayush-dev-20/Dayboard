import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { assertOwnedProject } from "@/db/mutations/guards";
import { projects, notes, tasks, todos, type NewProject, type Project } from "@/db/schema";
import { DEFAULT_PROJECT_COLOR } from "@/lib/colors";
import { AppError } from "@/lib/errors";
import type { ProjectDTO, ProjectRef } from "@/lib/projects/dto";
import type {
  AssignToProjectInput,
  CreateProjectInput,
  UpdateProjectInput,
} from "@/lib/validations/projects";

// Same rules as tasks: the owner's id is in every WHERE, and someone else's project behaves like
// one that doesn't exist.

function owned(userId: string, id: string, includeDeleted = false) {
  return and(
    eq(projects.id, id),
    eq(projects.userId, userId),
    includeDeleted ? undefined : isNull(projects.deletedAt),
  );
}

export function toProjectDTO(row: Project): ProjectDTO {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    status: row.status,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createProject(
  userId: string,
  input: CreateProjectInput,
): Promise<ProjectDTO> {
  const status = input.status ?? "ACTIVE";
  const [created] = await db
    .insert(projects)
    .values({
      userId,
      name: input.name,
      description: input.description ?? null,
      color: input.color ?? DEFAULT_PROJECT_COLOR,
      status,
      archivedAt: status === "ARCHIVED" ? new Date() : null,
    })
    .returning();
  if (!created) throw new AppError("INTERNAL_ERROR");
  return toProjectDTO(created);
}

export async function updateProject(
  userId: string,
  input: UpdateProjectInput,
): Promise<ProjectDTO> {
  const patch: Partial<NewProject> = {};
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.color !== undefined) patch.color = input.color;
  if (input.status !== undefined) {
    patch.status = input.status;
    // `archived_at` is set and cleared together with the ARCHIVED status.
    patch.archivedAt = input.status === "ARCHIVED" ? new Date() : null;
  }

  if (Object.keys(patch).length === 0) {
    const [row] = await db.select().from(projects).where(owned(userId, input.id)).limit(1);
    if (!row) throw new AppError("NOT_FOUND");
    return toProjectDTO(row);
  }

  const [updated] = await db.update(projects).set(patch).where(owned(userId, input.id)).returning();
  if (!updated) throw new AppError("NOT_FOUND");
  return toProjectDTO(updated);
}

/**
 * Moves only the project to Trash. Its tasks, todos and notes stay active and show as "No project"
 * while it is in Trash; `project_id` is kept so restoring brings the grouping back.
 */
export async function deleteProject(userId: string, id: string): Promise<{ deletedAt: string }> {
  const now = new Date();
  const [row] = await db
    .update(projects)
    .set({ deletedAt: now })
    .where(owned(userId, id))
    .returning({ id: projects.id });
  if (!row) throw new AppError("NOT_FOUND");
  return { deletedAt: now.toISOString() };
}

export async function restoreProject(userId: string, id: string): Promise<ProjectDTO> {
  const [row] = await db
    .update(projects)
    .set({ deletedAt: null })
    .where(and(owned(userId, id, true), eq(projects.userId, userId)))
    .returning();
  if (!row) throw new AppError("NOT_FOUND");
  return toProjectDTO(row);
}

/** Only from Trash (feature 04). The foreign keys then leave its items with no project. */
export async function permanentlyDeleteProject(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(projects)
      .where(owned(userId, id, true))
      .limit(1);
    if (!row) throw new AppError("NOT_FOUND");
    if (!row.deletedAt) throw new AppError("CONFLICT", "Move it to Trash first.");
    await tx.delete(projects).where(owned(userId, id, true));
  });
}

/**
 * Puts a task, todo or note in a project, or takes it out (`projectId: null`). Both the item and
 * the project must be the person's. A subtask follows its parent, so it can't be moved on its
 * own, and moving a parent moves its subtasks in the same step.
 */
export async function assignToProject(
  userId: string,
  input: AssignToProjectInput,
): Promise<{ project: ProjectRef | null }> {
  return db.transaction(async (tx) => {
    if (input.projectId) await assertOwnedProject(tx, userId, input.projectId);

    if (input.itemType === "task") {
      const [task] = await tx
        .select({ id: tasks.id, parentTaskId: tasks.parentTaskId })
        .from(tasks)
        .where(and(eq(tasks.id, input.itemId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))
        .limit(1);
      if (!task) throw new AppError("NOT_FOUND");
      if (task.parentTaskId) {
        throw new AppError("VALIDATION_ERROR", "A subtask stays in its task's project.");
      }
      await tx
        .update(tasks)
        .set({ projectId: input.projectId })
        .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
      await tx
        .update(tasks)
        .set({ projectId: input.projectId })
        .where(and(eq(tasks.parentTaskId, task.id), eq(tasks.userId, userId)));
    } else if (input.itemType === "todo") {
      const [row] = await tx
        .update(todos)
        .set({ projectId: input.projectId })
        .where(and(eq(todos.id, input.itemId), eq(todos.userId, userId), isNull(todos.deletedAt)))
        .returning({ id: todos.id });
      if (!row) throw new AppError("NOT_FOUND");
    } else {
      // Moving a note between projects is not an edit of its words: `version` is not touched.
      const [row] = await tx
        .update(notes)
        .set({ projectId: input.projectId })
        .where(and(eq(notes.id, input.itemId), eq(notes.userId, userId), isNull(notes.deletedAt)))
        .returning({ id: notes.id });
      if (!row) throw new AppError("NOT_FOUND");
    }

    if (!input.projectId) return { project: null };
    const [p] = await tx
      .select({
        id: projects.id,
        name: projects.name,
        color: projects.color,
        status: projects.status,
      })
      .from(projects)
      .where(owned(userId, input.projectId))
      .limit(1);
    return { project: p ?? null };
  });
}
