"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { FileText, Search, X } from "lucide-react";
import { toast } from "sonner";
import { findNotesToLink, linkTaskNote, unlinkTaskNote } from "@/actions/notes";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { handlePickerKeys } from "@/components/workspace/picker-list";
import type { NoteRefDTO } from "@/lib/tasks/dto";

type Props = {
  taskId: string;
  notes: NoteRefDTO[];
  onChange: (notes: NoteRefDTO[]) => void;
};

const linkButton =
  "type-body-md text-primary underline underline-offset-2 hover:text-primary-strong";

/** Notes linked to this task: chips that open the note, plus "Link note" and "New linked note". */
export function RelatedNotes({ taskId, notes, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteRefDTO[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function search(text: string) {
    const result = await findNotesToLink({ query: text });
    if (result.ok) setResults(result.data);
  }

  function onQuery(text: string) {
    setQuery(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void search(text), 200);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setQuery("");
      void search("");
    }
  }

  async function link(note: NoteRefDTO) {
    setOpen(false);
    const result = await linkTaskNote({ taskId, noteId: note.id });
    if (!result.ok) {
      toast.error("Couldn't link that note. Try again.");
      return;
    }
    if (!notes.some((n) => n.id === note.id)) onChange([...notes, note]);
  }

  async function unlink(note: NoteRefDTO) {
    const result = await unlinkTaskNote({ taskId, noteId: note.id });
    if (!result.ok) {
      toast.error("Couldn't unlink that note. Try again.");
      return;
    }
    onChange(notes.filter((n) => n.id !== note.id));
  }

  const linkedIds = new Set(notes.map((n) => n.id));
  const candidates = results.filter((n) => !linkedIds.has(n.id));

  return (
    <section aria-labelledby="related-notes-heading" className="mt-6">
      <h3 id="related-notes-heading" className="mb-2 type-label-caps text-muted-foreground">
        Related notes
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        {notes.map((note) => (
          <span
            key={note.id}
            className="inline-flex max-w-full items-center rounded-md bg-secondary text-foreground"
          >
            <Link
              href={`/notes/${note.id}`}
              className="flex min-h-11 min-w-0 items-center gap-1.5 rounded-l-md pr-1 pl-2.5 type-label-md hover:bg-accent md:min-h-8"
            >
              {note.emoji ? (
                <span aria-hidden>{note.emoji}</span>
              ) : (
                <FileText className="size-4 shrink-0" strokeWidth={1.5} aria-hidden />
              )}
              <span className="truncate">{note.title || "Untitled"}</span>
            </Link>
            <button
              type="button"
              aria-label={`Unlink ${note.title || "Untitled"}`}
              onClick={() => void unlink(note)}
              className="inline-flex size-11 items-center justify-center rounded-r-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
            >
              <X className="size-3.5" strokeWidth={1.5} aria-hidden />
            </button>
          </span>
        ))}

        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger className={`${linkButton} min-h-11 md:min-h-8`}>Link note</PopoverTrigger>
          <PopoverContent className="w-72 p-1" onKeyDown={handlePickerKeys}>
            <label className="relative block p-1">
              <span className="sr-only">Search your notes</span>
              <Search
                className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
                strokeWidth={1.5}
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => onQuery(e.target.value)}
                placeholder="Link a note"
                autoComplete="off"
                className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
              />
            </label>
            <div className="max-h-64 overflow-y-auto">
              {candidates.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  data-picker-item
                  onClick={() => void link(note)}
                  className="flex h-11 w-full items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8"
                >
                  {note.emoji ? <span aria-hidden>{note.emoji}</span> : null}
                  <span className="min-w-0 flex-1 truncate">{note.title || "Untitled"}</span>
                </button>
              ))}
              {candidates.length === 0 ? (
                <p className="px-2 py-3 type-body-sm text-muted-foreground">No notes to link.</p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>

        <Link
          href={`/notes/new?task=${taskId}`}
          className={`${linkButton} inline-flex min-h-11 items-center md:min-h-8`}
        >
          New linked note
        </Link>
      </div>
    </section>
  );
}
