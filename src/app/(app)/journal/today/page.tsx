import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { getDoneOnDay, getJournalTarget } from "@/db/queries/journal";
import { getTaskDetail } from "@/db/queries/tasks";
import type { SearchParams } from "@/lib/oauth-providers";
import { getDayPrefs } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Journal" };

// The add button's target (V3 feature 02 §6). The server works out today for this person. If today already has an
// entry (even an archived one) this opens it; if not, the editor opens with the date as its title and nothing is saved
// until the person types, as with a new note.
export default async function TodayEntryPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const prefs = await getDayPrefs(user.id);
  const target = await getJournalTarget(user.id, prefs);
  if (target.entryId) redirect(`/journal/${target.entryId}`);

  const raw = await searchParams;
  const taskParam = Array.isArray(raw.task) ? raw.task[0] : raw.task;
  const taskId = taskParam && idSchema.safeParse(taskParam).success ? taskParam : null;
  const [done, detail, taskContext] = await Promise.all([
    getDoneOnDay(user.id, target.date, prefs),
    taskId ? getTaskDetail(user.id, taskId) : Promise.resolve(null),
    taskId ? loadTaskContext(user.id) : Promise.resolve(null),
  ]);

  return (
    <>
      <NoteEditor
        key={target.date}
        note={null}
        journal={{ date: target.date, done, timeZone: prefs.timezone }}
      />
      {detail && taskContext ? (
        <TaskContextProvider value={taskContext.context}>
          <TaskDetailSheet detail={detail} />
        </TaskContextProvider>
      ) : null}
    </>
  );
}
