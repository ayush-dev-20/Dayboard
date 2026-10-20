"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { onNoteEvent } from "@/components/notes/note-events";
import { Tooltip } from "@/components/ui/tooltip";
import { isActive } from "@/components/layout/nav-items";
import { useSidebarSection } from "@/components/layout/sidebar-section";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { journalShortDate } from "@/lib/dates/journal";
import { SIDEBAR_ENTRIES, type JournalSidebarEntry } from "@/lib/journal/dto";
import { cn } from "@/lib/utils";

// The Journal row's extras in the sidebar (V3 feature 02 §6): a + that opens today's entry, and the latest five
// entries under the row, which fold like Projects. The list comes from the app layout; an entry made on this page
// (or in another tab) is added to it at once, without waiting for a refresh.

const itemBase =
  "flex h-11 cursor-pointer items-center gap-3 rounded-md px-2 transition-colors duration-150 lg:h-8";

/** The + at the end of the Journal row. The first row-level add control in the sidebar. */
export function JournalAddAction({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  return (
    <Tooltip label="New journal entry">
      <Link
        href="/journal/today"
        onClick={onNavigate}
        aria-label="New journal entry"
        className={cn(
          "inline-flex size-11 cursor-pointer items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100 lg:size-6 pointer-coarse:opacity-100",
          className,
        )}
      >
        <Plus className="size-3.5" strokeWidth={1.5} aria-hidden />
      </Link>
    </Tooltip>
  );
}

function useSidebarEntries(initial: JournalSidebarEntry[]) {
  const [entries, setEntries] = useState(initial);
  const [seen, setSeen] = useState(initial);
  // A newer render of the layout (the person archived or deleted an entry) replaces what was added here.
  if (seen !== initial) {
    setSeen(initial);
    setEntries(initial);
  }
  useEffect(
    () =>
      onNoteEvent((event) => {
        if (event.type !== "journal") return;
        setEntries((current) =>
          [event.entry, ...current.filter((e) => e.id !== event.entry.id)]
            .sort((a, b) => b.date.localeCompare(a.date))
            .slice(0, SIDEBAR_ENTRIES),
        );
      }),
    [],
  );
  return entries;
}

export function SidebarJournal({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { journalEntries } = useWorkspace();
  const { shown } = useSidebarSection("journal");
  const entries = useSidebarEntries(journalEntries);
  if (!shown || entries.length === 0) return null;
  return (
    <ul className="mt-0.5 flex flex-col gap-0.5" aria-label="Latest journal entries">
      {entries.map((entry) => {
        const href = `/journal/${entry.id}`;
        const here = isActive(pathname, href);
        return (
          <li key={entry.id}>
            <Link
              href={href}
              onClick={onNavigate}
              title={entry.firstLine || undefined}
              aria-current={here ? "page" : undefined}
              className={cn(
                itemBase,
                "pl-8 type-body-sm",
                here
                  ? "bg-sidebar-accent text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
              )}
            >
              <span className="truncate">{journalShortDate(entry.date)}</span>
            </Link>
          </li>
        );
      })}
      <li>
        <Link
          href="/journal"
          onClick={onNavigate}
          className={cn(
            itemBase,
            "pl-8 type-body-sm text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
          )}
        >
          Show all
        </Link>
      </li>
    </ul>
  );
}
