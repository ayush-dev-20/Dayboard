"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import type { NoteChildDTO } from "@/lib/notes/dto";

// The automatic "Sub-notes" list at the end of a note (V2 feature 07 §3): every sub-note whose block
// is not in the text (the block was deleted, or the text was edited somewhere else). Deleting a
// block removes only the block, so a sub-note is never hidden.

export function SubNotesSection({ notes }: { notes: NoteChildDTO[] }) {
  if (notes.length === 0) return null;
  return (
    <section aria-labelledby="sub-notes-heading" className="mt-8">
      <h2 id="sub-notes-heading" className="pb-2 type-label-caps text-muted-foreground">
        Sub-notes <span className="type-data-sm">{notes.length}</span>
      </h2>
      <ul className="border-t border-border">
        {notes.map((note) => (
          <li key={note.id} className="border-b border-border">
            <Link
              href={`/notes/${note.id}`}
              className="flex min-h-row-touch items-center gap-2 px-2 py-2 type-body-md hover:bg-accent md:min-h-row md:py-1"
            >
              {note.emoji ? (
                <span aria-hidden>{note.emoji}</span>
              ) : (
                <FileText
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
              )}
              <span className="min-w-0 flex-1 truncate">{note.title.trim() || "Untitled"}</span>
              {note.archived ? (
                <span className="shrink-0 type-body-sm text-muted-foreground">Archived</span>
              ) : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
