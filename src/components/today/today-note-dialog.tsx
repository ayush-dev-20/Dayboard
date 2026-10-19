"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ExpandableDialog } from "@/components/layout/expandable-dialog";
import { NoteEditor } from "@/components/notes/note-editor";
import { RecordOpened } from "@/components/search/record-opened";
import type { BacklinkDTO, NoteDTO } from "@/lib/notes/dto";

/**
 * A note opened from Today (`/today?note=id`): the real note editor in a large dialog over the day. Close goes back
 * to plain Today; Expand goes to the note's own page. The server reads the note, so it is the same note, with the
 * same checks, as on that page.
 */
export function TodayNoteDialog({ note, backlinks }: { note: NoteDTO; backlinks: BacklinkDTO[] }) {
  const router = useRouter();
  const close = useCallback(() => router.push("/today", { scroll: false }), [router]);
  return (
    <ExpandableDialog
      onClose={close}
      expandHref={`/notes/${note.id}`}
      title={note.title.trim() || "Untitled note"}
    >
      <RecordOpened type="note" id={note.id} />
      {/* Keyed by id, as on the note's page, so moving from one note to another never carries state over. */}
      <NoteEditor key={note.id} note={note} backlinks={backlinks} />
    </ExpandableDialog>
  );
}
