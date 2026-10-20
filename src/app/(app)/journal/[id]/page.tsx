import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { RecordOpened } from "@/components/search/record-opened";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { getBacklinks } from "@/db/queries/note-tree";
import { getDoneOnDay, getJournalEntry } from "@/db/queries/journal";
import { getTaskDetail } from "@/db/queries/tasks";
import type { SearchParams } from "@/lib/oauth-providers";
import { getDayPrefs } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Journal" };

// One journal entry (V3 feature 02 §6): the note page with `journal` set. `?task=id` opens a finished task in the side
// panel without leaving the entry. A malformed id, someone else's id and an ordinary note all look like a missing page.
export default async function JournalEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();

  const raw = await searchParams;
  const taskParam = Array.isArray(raw.task) ? raw.task[0] : raw.task;
  const taskId = taskParam && idSchema.safeParse(taskParam).success ? taskParam : null;

  const [entry, backlinks, prefs, detail, taskContext] = await Promise.all([
    getJournalEntry(user.id, id),
    getBacklinks(user.id, id),
    getDayPrefs(user.id),
    taskId ? getTaskDetail(user.id, taskId) : Promise.resolve(null),
    taskId ? loadTaskContext(user.id) : Promise.resolve(null),
  ]);
  if (!entry?.journalDate) notFound();
  const done = await getDoneOnDay(user.id, entry.journalDate, prefs);

  return (
    <>
      <RecordOpened type="note" id={entry.id} />
      <NoteEditor
        key={entry.id}
        note={entry}
        backlinks={backlinks}
        journal={{ date: entry.journalDate, done, timeZone: prefs.timezone }}
      />
      {detail && taskContext ? (
        <TaskContextProvider value={taskContext.context}>
          <TaskDetailSheet detail={detail} />
        </TaskContextProvider>
      ) : null}
    </>
  );
}
