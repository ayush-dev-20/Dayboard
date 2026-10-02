"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/tags";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import type { TagDTO } from "@/lib/tags";
import {
  createTagSchema,
  deleteTagSchema,
  renameTagSchema,
  setTagColorSchema,
  setTagsSchema,
} from "@/lib/validations/tags";

function refreshTags() {
  revalidatePath("/", "layout");
}

/** Safe to call twice: an existing tag with the same name is returned instead of an error. */
export async function createTag(input: unknown): Promise<ActionResult<TagDTO>> {
  return runAction("tags.create", async () => {
    const user = await requireUser();
    const tag = await mutations.createTag(user.id, createTagSchema.parse(input));
    refreshTags();
    return tag;
  });
}

export async function renameTag(input: unknown): Promise<ActionResult<TagDTO>> {
  return runAction("tags.rename", async () => {
    const user = await requireUser();
    const { id, name } = renameTagSchema.parse(input);
    const tag = await mutations.renameTag(user.id, id, name);
    refreshTags();
    return tag;
  });
}

export async function setTagColor(input: unknown): Promise<ActionResult<TagDTO>> {
  return runAction("tags.setColor", async () => {
    const user = await requireUser();
    const { id, color } = setTagColorSchema.parse(input);
    const tag = await mutations.setTagColor(user.id, id, color);
    refreshTags();
    return tag;
  });
}

export async function deleteTag(input: unknown): Promise<ActionResult> {
  return runAction("tags.delete", async () => {
    const user = await requireUser();
    const { id } = deleteTagSchema.parse(input);
    await mutations.deleteTag(user.id, id);
    refreshTags();
  });
}

export async function setTaskTags(input: unknown): Promise<ActionResult<TagDTO[]>> {
  return runAction("tags.setTaskTags", async () => {
    const user = await requireUser();
    const { id, tagIds } = setTagsSchema.parse(input);
    const result = await mutations.setTaskTags(user.id, id, tagIds);
    revalidatePath("/tasks", "layout");
    return result;
  });
}

export async function setNoteTags(input: unknown): Promise<ActionResult<TagDTO[]>> {
  return runAction("tags.setNoteTags", async () => {
    const user = await requireUser();
    const { id, tagIds } = setTagsSchema.parse(input);
    const result = await mutations.setNoteTags(user.id, id, tagIds);
    revalidatePath("/notes", "layout");
    return result;
  });
}
