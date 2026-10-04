import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus, Sparkles } from "lucide-react";
import { NoteCard, NoteTile } from "@/components/notes/note-card";
import { NotesFilters } from "@/components/notes/notes-filters";
import { EmptyState } from "@/components/layout/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { countNotes, listNotes } from "@/db/queries/notes";
import { env } from "@/lib/env";
import { getPreferences } from "@/lib/preferences";
import {
  buildNotesQuery,
  hasNoteFilters,
  parseNotesParams,
  parseNotesView,
} from "@/lib/notes/params";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";

export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const raw = await searchParams;
  const params = parseNotesParams(raw);
  const view = parseNotesView(raw);
  const scope = { projectId: params.projectId ?? undefined, tagId: params.tagId ?? undefined };

  const [{ timezone, aiEnabled }, notes, archived, counts] = await Promise.all([
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
    <PageContainer width={view === "grid" ? "wide" : "content"}>
      <PageHeader
        title="Notes"
        description={`${counts.active} ${counts.active === 1 ? "note" : "notes"}`}
      >
        {env.aiAvailable && aiEnabled ? (
          <Link href="/notes/new?ai=1" className={buttonVariants({ variant: "secondary" })}>
            <Sparkles strokeWidth={1.5} aria-hidden /> Write with AI
          </Link>
        ) : null}
        <Link href="/notes/new" className={buttonVariants()}>
          <Plus strokeWidth={1.5} aria-hidden /> New note
        </Link>
      </PageHeader>

      <NotesFilters params={params} view={view} />

      <div className="mt-4">
        {nothingAtAll ? (
          <EmptyState
            illustration="notes-empty"
            title="No notes yet."
            description="Notes autosave as you type. Press Shift+N from anywhere."
          >
            <Link href="/notes/new" className={buttonVariants()}>
              <Plus strokeWidth={1.5} aria-hidden /> New note
            </Link>
          </EmptyState>
        ) : noMatches ? (
          <EmptyState
            title="No notes match these filters."
            description="Nothing is hidden or deleted."
          >
            <Link
              href={`/notes${buildNotesQuery({ view })}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Clear filters
            </Link>
          </EmptyState>
        ) : (
          <>
            {notes.length > 0 ? (
              view === "grid" ? (
                <ul
                  className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
                  aria-label="Notes"
                >
                  {notes.map((note) => (
                    <NoteTile key={note.id} note={note} now={now} timeZone={timezone} />
                  ))}
                </ul>
              ) : (
                <ul className="border-t border-border" aria-label="Notes">
                  {notes.map((note) => (
                    <NoteCard key={note.id} note={note} now={now} timeZone={timezone} />
                  ))}
                </ul>
              )
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
    </PageContainer>
  );
}
