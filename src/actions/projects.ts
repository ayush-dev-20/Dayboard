"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/projects";
import { runAction, type ActionResult } from "@/lib/actions";
import type { ProjectDTO, ProjectRef } from "@/lib/projects/dto";
import { requireUser } from "@/lib/session";
import {
  assignToProjectSchema,
  createProjectSchema,
  updateProjectSchema,
} from "@/lib/validations/projects";
import { idOnlySchema } from "@/lib/validations/tasks";

// Who is asking -> is the input valid -> do it, scoped to that person -> refresh.

// The project list feeds pickers on every screen, so a change refreshes the whole app layout.
function refreshEverywhere() {
  revalidatePath("/", "layout");
}

export async function createProject(input: unknown): Promise<ActionResult<ProjectDTO>> {
  return runAction("projects.create", async () => {
    const user = await requireUser();
    const project = await mutations.createProject(user.id, createProjectSchema.parse(input));
    refreshEverywhere();
    return project;
  });
}

export async function updateProject(input: unknown): Promise<ActionResult<ProjectDTO>> {
  return runAction("projects.update", async () => {
    const user = await requireUser();
    const project = await mutations.updateProject(user.id, updateProjectSchema.parse(input));
    refreshEverywhere();
    return project;
  });
}

export async function deleteProject(input: unknown): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("projects.delete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const result = await mutations.deleteProject(user.id, id);
    refreshEverywhere();
    return result;
  });
}

export async function restoreProject(input: unknown): Promise<ActionResult<ProjectDTO>> {
  return runAction("projects.restore", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    const project = await mutations.restoreProject(user.id, id);
    refreshEverywhere();
    return project;
  });
}

export async function permanentlyDeleteProject(input: unknown): Promise<ActionResult> {
  return runAction("projects.permanentlyDelete", async () => {
    const user = await requireUser();
    const { id } = idOnlySchema.parse(input);
    await mutations.permanentlyDeleteProject(user.id, id);
    refreshEverywhere();
  });
}

export async function assignToProject(
  input: unknown,
): Promise<ActionResult<{ project: ProjectRef | null }>> {
  return runAction("projects.assign", async () => {
    const user = await requireUser();
    const result = await mutations.assignToProject(user.id, assignToProjectSchema.parse(input));
    revalidatePath("/tasks", "layout");
    revalidatePath("/notes", "layout");
    revalidatePath("/projects", "layout");
    return result;
  });
}
