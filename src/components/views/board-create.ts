import { toast } from "sonner";
import { createNote } from "@/actions/notes";
import { setNoteTags, setTaskTags } from "@/actions/tags";
import { createTask } from "@/actions/tasks";
import { createTodo } from "@/actions/todos";
import { dateForBucket } from "@/lib/views/move-card";
import { NO_VALUE_KEY } from "@/lib/views/group";
import type { Collection } from "@/lib/views/types";
import type { EngineContext } from "@/lib/views/values";

/**
 * "+ New" at the bottom of a column (V2 feature 06 §5): the new item already carries that column's
 * value, made with the same actions as everywhere else. Returns false (after telling the person)
 * when it could not be made.
 */
export async function createInColumn(
  collection: Collection,
  groupBy: string,
  columnKey: string,
  title: string,
  ctx: EngineContext,
  projectScope: string | null,
): Promise<boolean> {
  const value = columnKey === NO_VALUE_KEY ? null : columnKey;
  const fail = (message?: string) => {
    toast.error(message ?? "Couldn't add that. Try again.");
    return false;
  };
  const projectId = groupBy === "project" ? value : projectScope;

  if (collection === "TASKS") {
    const input: Record<string, unknown> = { title, ...(projectId ? { projectId } : {}) };
    if (groupBy === "status") input.status = columnKey;
    if (groupBy === "priority") input.priority = columnKey;
    if (groupBy === "dueBucket" || groupBy === "dueList") {
      const target = dateForBucket(columnKey === "upcoming" ? "week" : columnKey, null, ctx);
      if ("refused" in target) return fail(target.refused);
      if (target.date) input.dueDate = target.date;
    }
    const created = await createTask(input);
    if (!created.ok)
      return fail(Object.values(created.error.fieldErrors ?? {})[0] ?? created.error.message);
    if (groupBy === "tag" && value) await setTaskTags({ id: created.data.id, tagIds: [value] });
    return true;
  }

  if (collection === "TODOS") {
    const input: Record<string, unknown> = { title, ...(projectId ? { projectId } : {}) };
    if (groupBy === "dueBucket") {
      const target = dateForBucket(columnKey, null, ctx);
      if ("refused" in target) return fail(target.refused);
      if (target.date) input.dueDate = target.date;
    }
    const created = await createTodo(input);
    if (!created.ok)
      return fail(Object.values(created.error.fieldErrors ?? {})[0] ?? created.error.message);
    return true;
  }

  const created = await createNote({ title, ...(projectId ? { projectId } : {}) });
  if (!created.ok)
    return fail(Object.values(created.error.fieldErrors ?? {})[0] ?? created.error.message);
  if (groupBy === "tag" && value) await setNoteTags({ id: created.data.id, tagIds: [value] });
  return true;
}
