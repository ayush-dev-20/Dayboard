import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { RecordOpened } from "@/components/search/record-opened";
import { getBacklinks } from "@/db/queries/note-tree";
import { getNote } from "@/db/queries/notes";
import { requireUser } from "@/lib/session";
import { readAccessFor } from "@/modules/permissions/acting";
import { env } from "@/lib/env";
import { noteEditorIds } from "@/modules/permissions/editors";
import { shareContext } from "@/modules/sharing/service";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Note" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  // A malformed id and someone else's id both look like any other missing page.
  if (!idSchema.safeParse(id).success) notFound();

  // The owner's rows, read through the person's access (V3 feature 04). Backlinks stay the owner's own: what links here
  // may be in notes nobody shared.
  const access = await readAccessFor(user.id, "NOTE", id);
  if (!access) notFound();
  const [note, backlinks] = await Promise.all([
    getNote(access.ownerId, id),
    access.role === "OWNER" ? getBacklinks(user.id, id) : Promise.resolve([]),
  ]);
  if (!note) notFound();
  // Live only while someone other than the owner can edit it and the collaboration service is configured (feature 05 §2).
  const live = env.collabEnabled && (await noteEditorIds(note.id)).length > 0;
  const share = await shareContext(user.id, access, "NOTE", id);
  // A journal entry has its own page (V3 feature 02): every older link to it still lands there.
  if (note.journalDate) redirect(`/journal/${note.id}`);

  // Keyed by id, so moving from one note to another never carries state over.
  return (
    <>
      <RecordOpened type="note" id={note.id} />
      <NoteEditor
        key={note.id}
        note={note}
        backlinks={backlinks}
        access={share}
        collab={live ? { enabled: true, user: { id: user.id, name: user.name } } : undefined}
      />
    </>
  );
}
