"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { setFocusTask } from "@/db/mutations/today";
import { findFocusCandidates } from "@/db/queries/today";
import { runAction, type ActionResult } from "@/lib/actions";
import { requireUser } from "@/lib/session";
import { idSchema } from "@/lib/validations/tasks";

const focusSchema = z.strictObject({ taskId: idSchema.nullable() });

/** Today's focus: one open task of the person's own, or null to clear it. The AI never sets this. */
export async function setFocus(input: unknown): Promise<ActionResult> {
  return runAction("today.setFocus", async () => {
    const user = await requireUser();
    const { taskId } = focusSchema.parse(input);
    await setFocusTask(user.id, taskId);
    revalidatePath("/today");
  });
}

const findSchema = z.strictObject({ query: z.string().max(100) });

export async function findFocusTasks(
  input: unknown,
): Promise<
  ActionResult<{ id: string; title: string; emoji: string | null; dueDate: string | null }[]>
> {
  return runAction("today.findFocus", async () => {
    const user = await requireUser();
    const { query } = findSchema.parse(input);
    return findFocusCandidates(user.id, query);
  });
}
