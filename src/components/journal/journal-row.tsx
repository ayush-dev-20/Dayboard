import Link from "next/link";
import { journalTitle } from "@/lib/dates/journal";
import type { JournalEntryRow } from "@/lib/journal/dto";
import { cn } from "@/lib/utils";

/**
 * One entry in the Journal list: its title (the date unless renamed), the first line of the text and how much was
 * finished that day. A row, not a card; the whole row is the link. "Archived" is a word, not only a colour.
 */
export function JournalRow({ entry, className }: { entry: JournalEntryRow; className?: string }) {
  return (
    <li className={cn("border-b border-border", className)}>
      <Link
        href={`/journal/${entry.id}`}
        className="flex min-h-row-touch items-center gap-2 px-3 py-2 transition-colors duration-[120ms] hover:bg-accent md:min-h-row md:py-1"
      >
        <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
          {entry.emoji ?? ""}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-3 pr-2">
          <span className="min-w-0 truncate text-[16px] max-md:shrink md:shrink-0 md:text-[14px]">
            {entry.title.trim() || journalTitle(entry.date)}
          </span>
          <span className="hidden min-w-0 truncate type-body-sm text-muted-foreground md:inline">
            {entry.firstLine}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3 type-data-sm text-muted-foreground">
          {entry.archived ? <span className="type-label-caps">Archived</span> : null}
          {entry.doneCount > 0 ? <span>{entry.doneCount} done</span> : null}
        </span>
      </Link>
    </li>
  );
}
