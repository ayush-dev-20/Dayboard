import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoteEditor } from "@/components/notes/note-editor";
import { getBacklinks } from "@/db/queries/note-tree";
import { getNote } from "@/db/queries/notes";
import { requireUser } from "@/lib/session";
import { idSchema } from "@/lib/validations/tasks";

export const metadata: Metadata = { title: "Note" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser({ redirect: true });
  const { id } = await params;
  // A malformed id and someone else's id both look like any other missing page.
  if (!idSchema.safeParse(id).success) notFound();

  const [note, backlinks] = await Promise.all([getNote(user.id, id), getBacklinks(user.id, id)]);
  if (!note) notFound();

  // Keyed by id, so moving from one note to another never carries state over.
  return <NoteEditor key={note.id} note={note} backlinks={backlinks} />;
}
