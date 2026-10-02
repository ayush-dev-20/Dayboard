import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { NoteCard } from "@/components/notes/note-card";
import { NotesFilters } from "@/components/notes/notes-filters";
import { EmptyState } from "@/components/layout/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { countNotes, listNotes } from "@/db/queries/notes";
import { getPreferences } from "@/lib/preferences";
import { hasNoteFilters, parseNotesParams } from "@/lib/notes/params";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const params = parseNotesParams(await searchParams);
  const scope = { projectId: params.projectId ?? undefined, tagId: params.tagId ?? undefined };

  const [{ timezone }, notes, archived, counts] = await Promise.all([
    getPreferences(user.id),
    listNotes(user.id, scope),
    listNotes(user.id, { ...scope, archived: true, limit: 200 }),
    countNotes(user.id, scope),
  ]);
  const now = new Date();
  const filtered = hasNoteFilters(params);
  const nothingAtAll = counts.active + counts.archived === 0 && !filtered;
  const noMatches = notes.length === 0 && archived.length === 0 && filtered;

  return (
    <div className="max-w-content">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="sr-only type-headline-lg text-foreground md:not-sr-only">Notes</h1>
          <p className="mt-1 type-body-md text-muted-foreground">
            {counts.active} {counts.active === 1 ? "note" : "notes"}
          </p>
        </div>
        <Link href="/notes/new" className={buttonVariants()}>
          <Plus strokeWidth={1.5} aria-hidden /> New note
        </Link>
      </header>

      <NotesFilters params={params} />

      <div className="mt-4">
        {nothingAtAll ? (
          <EmptyState
            title="No notes yet."
            description="Notes autosave as you type. Press Shift+N from anywhere."
          >
            <Link href="/notes/new" className={buttonVariants()}>
              New note
            </Link>
          </EmptyState>
        ) : noMatches ? (
          <EmptyState
            title="No notes match these filters."
            description="Nothing is hidden or deleted."
          >
            <Link href="/notes" className={buttonVariants({ variant: "secondary" })}>
              Clear filters
            </Link>
          </EmptyState>
        ) : (
          <>
            {notes.length > 0 ? (
              <ul className="border-t border-border" aria-label="Notes">
                {notes.map((note) => (
                  <NoteCard key={note.id} note={note} now={now} timeZone={timezone} />
                ))}
              </ul>
            ) : (
              <p className="py-4 type-body-md text-muted-foreground">
                No notes here. Archived notes are below.
              </p>
            )}

            {archived.length > 0 ? (
              <details className="group mt-8">
                <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  Archived
                  <span className="type-data-sm">{counts.archived}</span>
                </summary>
                <ul className="border-t border-border" aria-label="Archived notes">
                  {archived.map((note) => (
                    <NoteCard key={note.id} note={note} now={now} timeZone={timezone} />
                  ))}
                </ul>
              </details>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
