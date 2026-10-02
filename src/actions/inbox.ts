"use server";

import { revalidatePath } from "next/cache";
import * as mutations from "@/db/mutations/inbox";
import { runAction, type ActionResult } from "@/lib/actions";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import {
  captureInboxSchema,
  convertInboxSchema,
  inboxIdSchema,
  updateInboxSchema,
} from "@/lib/validations/inbox";
import type { ConvertedRef } from "@/db/schema";

// Who is asking -> is the input valid -> do it, scoped to that person -> refresh.

// The sidebar's Inbox and Today numbers come from the layout, so these refresh it too.
function refreshInbox() {
  revalidatePath("/inbox");
  revalidatePath("/today");
  revalidatePath("/", "layout");
}

export async function captureInboxItem(input: unknown): Promise<ActionResult<{ id: string }>> {
  return runAction("inbox.capture", async () => {
    const user = await requireUser();
    const { text } = captureInboxSchema.parse(input);
    const item = await mutations.captureInboxItem(user.id, text);
    refreshInbox();
    return item;
  });
}

export async function updateInboxItem(input: unknown): Promise<ActionResult> {
  return runAction("inbox.update", async () => {
    const user = await requireUser();
    const { id, text } = updateInboxSchema.parse(input);
    await mutations.updateInboxItem(user.id, id, text);
    revalidatePath("/inbox");
  });
}

/** Creates what the person chose and marks the item converted, in one transaction. */
export async function convertInboxItem(
  input: unknown,
): Promise<ActionResult<{ refs: ConvertedRef[] }>> {
  return runAction("inbox.convert", async () => {
    const user = await requireUser();
    const values = convertInboxSchema.parse(input);
    const { defaultTaskPriority } = await getPreferences(user.id);
    const result = await mutations.convertInboxItem(user.id, values, {
      priority: defaultTaskPriority,
    });
    refreshInbox();
    revalidatePath("/tasks", "layout");
    revalidatePath("/notes", "layout");
    return result;
  });
}

export async function archiveInboxItem(input: unknown): Promise<ActionResult> {
  return runAction("inbox.archive", async () => {
    const user = await requireUser();
    const { id } = inboxIdSchema.parse(input);
    await mutations.setInboxArchived(user.id, id, true);
    refreshInbox();
  });
}

export async function unarchiveInboxItem(input: unknown): Promise<ActionResult> {
  return runAction("inbox.unarchive", async () => {
    const user = await requireUser();
    const { id } = inboxIdSchema.parse(input);
    await mutations.setInboxArchived(user.id, id, false);
    refreshInbox();
  });
}

export async function deleteInboxItem(
  input: unknown,
): Promise<ActionResult<{ deletedAt: string }>> {
  return runAction("inbox.delete", async () => {
    const user = await requireUser();
    const { id } = inboxIdSchema.parse(input);
    const result = await mutations.deleteInboxItem(user.id, id);
    refreshInbox();
    return result;
  });
}

export async function restoreInboxItem(input: unknown): Promise<ActionResult> {
  return runAction("inbox.restore", async () => {
    const user = await requireUser();
    const { id } = inboxIdSchema.parse(input);
    await mutations.restoreInboxItem(user.id, id);
    refreshInbox();
    revalidatePath("/trash");
  });
}

export async function permanentlyDeleteInboxItem(input: unknown): Promise<ActionResult> {
  return runAction("inbox.permanentlyDelete", async () => {
    const user = await requireUser();
    const { id } = inboxIdSchema.parse(input);
    await mutations.permanentlyDeleteInboxItem(user.id, id);
    revalidatePath("/trash");
  });
}
