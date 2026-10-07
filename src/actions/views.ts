"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/views";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import {
  createViewSchema,
  duplicateViewSchema,
  reorderViewSchema,
  updateViewSchema,
  viewIdSchema,
} from "@/lib/validations/views";
import type { ViewDTO } from "@/lib/views/types";

// Saved views (V2 feature 06 §6). Settings changes call `updateView` as the person edits (no save
// step); the page refreshes itself from the client, so only structural changes revalidate here.

function refreshViews() {
  revalidatePath("/tasks", "layout");
  revalidatePath("/notes", "layout");
  revalidatePath("/projects", "layout");
}

export async function createView(input: unknown): Promise<ActionResult<ViewDTO>> {
  return runAction("views.create", async () => {
    const user = await requireUser();
    const view = await mutations.createView(user.id, createViewSchema.parse(input));
    refreshViews();
    return view;
  });
}

export async function updateView(input: unknown): Promise<ActionResult<ViewDTO>> {
  return runAction("views.update", async () => {
    const user = await requireUser();
    return mutations.updateView(user.id, updateViewSchema.parse(input));
  });
}

export async function duplicateView(input: unknown): Promise<ActionResult<ViewDTO>> {
  return runAction("views.duplicate", async () => {
    const user = await requireUser();
    const view = await mutations.duplicateView(user.id, duplicateViewSchema.parse(input));
    refreshViews();
    return view;
  });
}

export async function reorderView(input: unknown): Promise<ActionResult> {
  return runAction("views.reorder", async () => {
    const user = await requireUser();
    await mutations.reorderView(user.id, reorderViewSchema.parse(input));
    refreshViews();
  });
}

export async function deleteView(input: unknown): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("views.delete", async () => {
    const user = await requireUser();
    const { id } = viewIdSchema.parse(input);
    const result = await mutations.deleteView(user.id, id);
    refreshViews();
    return result;
  });
}

export async function restoreView(input: unknown): Promise<ActionResult<ViewDTO>> {
  return runAction("views.restore", async () => {
    const user = await requireUser();
    const { id } = viewIdSchema.parse(input);
    const view = await mutations.restoreView(user.id, id);
    refreshViews();
    return view;
  });
}
