"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { restoreInboxItem, permanentlyDeleteInboxItem } from "@/db/mutations/inbox";
import { restoreNote, permanentlyDeleteNote } from "@/db/mutations/notes";
import { restoreProject, permanentlyDeleteProject } from "@/db/mutations/projects";
import { permanentlyDeleteTask, restoreTask } from "@/db/mutations/tasks";
import { permanentlyDeleteTodo, restoreTodo } from "@/db/mutations/todos";
import { emptyTrash as emptyTrashMutation } from "@/db/mutations/trash";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import { TRASH_TYPES, trashHref, type TrashType } from "@/lib/trash";
import { idSchema } from "@/lib/validations/tasks";

// Trash calls each owning feature's own restore and delete, so the rules (a restored task whose
// project is still in Trash shows "No project", a subtask can't come back before its task) stay in
// one place. Permanent deletion is never optimistic and only works on items already in Trash.

const itemSchema = z.strictObject({ type: z.enum(TRASH_TYPES), id: idSchema });
const emptySchema = z.strictObject({ type: z.enum(TRASH_TYPES).nullish() });

function refresh() {
  revalidatePath("/trash");
  revalidatePath("/", "layout");
}

export async function restoreTrashItem(input: unknown): Promise<ActionResult<{ href: string }>> {
  return runAction("trash.restore", async () => {
    const user = await requireUser();
    const { type, id } = itemSchema.parse(input);
    const restore: Record<TrashType, () => Promise<unknown>> = {
      task: () => restoreTask(user.id, id),
      todo: () => restoreTodo(user.id, id),
      note: () => restoreNote(user.id, id),
      project: () => restoreProject(user.id, id),
      inbox: () => restoreInboxItem(user.id, id),
    };
    await restore[type]();
    refresh();
    return { href: trashHref(type, id) };
  });
}

export async function permanentlyDeleteTrashItem(input: unknown): Promise<ActionResult> {
  return runAction("trash.permanentlyDelete", async () => {
    const user = await requireUser();
    const { type, id } = itemSchema.parse(input);
    const remove: Record<TrashType, () => Promise<unknown>> = {
      task: () => permanentlyDeleteTask(user.id, id),
      todo: () => permanentlyDeleteTodo(user.id, id),
      note: () => permanentlyDeleteNote(user.id, id),
      project: () => permanentlyDeleteProject(user.id, id),
      inbox: () => permanentlyDeleteInboxItem(user.id, id),
    };
    await remove[type]();
    refresh();
  });
}

export async function emptyTrash(input: unknown): Promise<ActionResult<{ deleted: number }>> {
  return runAction("trash.empty", async () => {
    const user = await requireUser();
    const { type } = emptySchema.parse(input);
    const result = await emptyTrashMutation(user.id, type ?? null);
    refresh();
    return result;
  });
}
