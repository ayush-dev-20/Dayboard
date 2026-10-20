"use client";

import { useState } from "react";
import { toast } from "sonner";
import { loadMoreJournalEntries } from "@/actions/journal";
import { Button } from "@/components/ui/button";
import { journalMonthLabel } from "@/lib/dates/journal";
import type { JournalEntryRow } from "@/lib/journal/dto";
import { JournalRow } from "./journal-row";

// The entries below today's row, newest first and grouped by month (V3 feature 02 §6). The first page comes from the
// server; "Load more" asks for the next 30. No cards: a hairline list under a month heading.

function byMonth(entries: JournalEntryRow[]): { label: string; rows: JournalEntryRow[] }[] {
  const groups: { label: string; rows: JournalEntryRow[] }[] = [];
  for (const entry of entries) {
    const label = journalMonthLabel(entry.date);
    const last = groups[groups.length - 1];
    if (last?.label === label) last.rows.push(entry);
    else groups.push({ label, rows: [entry] });
  }
  return groups;
}

export function JournalList({
  initial,
  next: initialNext,
}: {
  initial: JournalEntryRow[];
  next: string | null;
}) {
  const [entries, setEntries] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [busy, setBusy] = useState(false);

  async function loadMore() {
    if (!next) return;
    setBusy(true);
    const result = await loadMoreJournalEntries({ before: next });
    setBusy(false);
    if (!result.ok) {
      toast.error("Couldn't load more entries. Try again.");
      return;
    }
    setEntries((current) => [...current, ...result.data.items]);
    setNext(result.data.next);
  }

  return (
    <div>
      {byMonth(entries).map((group) => (
        <section key={group.label} aria-label={group.label} className="mt-6 first:mt-0">
          <h2 className="pb-2 type-label-caps text-muted-foreground">{group.label}</h2>
          <ul className="border-t border-border">
            {group.rows.map((entry) => (
              <JournalRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </section>
      ))}
      {next ? (
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void loadMore()} disabled={busy}>
            {busy ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
