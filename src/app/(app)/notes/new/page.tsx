import type { Metadata } from "next";
import { NoteEditor } from "@/components/notes/note-editor";
import { listProjectRefs } from "@/db/queries/projects";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { idSchema } from "@/lib/validations/tasks";
import { isLinkableTask } from "./task-link";

export const metadata: Metadata = { title: "New note" };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Nothing is saved here until the first keystroke. `?project=<id>` starts the note inside a
 * project, `?task=<id>` links it to a task as it is created. An id that isn't the person's own is
 * simply ignored.
 */
export default async function NewNotePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const raw = await searchParams;
  const projectParam = first(raw.project);
  const taskParam = first(raw.task);

  const projects = await listProjectRefs(user.id);
  const project =
    projectParam && idSchema.safeParse(projectParam).success
      ? (projects.find((p) => p.id === projectParam) ?? null)
      : null;
  const linkTaskId =
    taskParam && idSchema.safeParse(taskParam).success && (await isLinkableTask(user.id, taskParam))
      ? taskParam
      : null;

  return <NoteEditor note={null} start={{ project, linkTaskId }} />;
}
