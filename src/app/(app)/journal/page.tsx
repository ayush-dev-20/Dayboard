import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { JournalList } from "@/components/journal/journal-list";
import { JournalRow } from "@/components/journal/journal-row";
import { buttonVariants } from "@/components/ui/button";
import { getJournalTarget, listJournalEntries } from "@/db/queries/journal";
import { journalTitle } from "@/lib/dates/journal";
import { getDayPrefs } from "@/lib/preferences";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Journal" };

// The Journal (V3 feature 02 §6): today's row on top, then the entries newest first by month, archived ones folded
// below. The day is the person's own, worked out here on the server.
export default async function JournalPage() {
  const user = await requireUser({ redirect: true });
  const prefs = await getDayPrefs(user.id);
  const [target, page, archived] = await Promise.all([
    getJournalTarget(user.id, prefs),
    listJournalEntries(user.id, prefs),
    listJournalEntries(user.id, prefs, { archived: true, limit: 100 }),
  ]);

  // Today's entry, if it is on the first page, sits in the row at the top and not twice.
  const todayEntry =
    [...page.items, ...archived.items].find((entry) => entry.date === target.date) ?? null;
  const rest = page.items.filter((entry) => entry.date !== target.date);
  const hasAny = page.items.length > 0 || archived.items.length > 0;
  const startLink = buttonVariants({ variant: "primary" });

  return (
    <PageContainer>
      <PageHeader
        title="Journal"
        description={hasAny ? `${page.items.length}${page.next ? "+" : ""} entries` : undefined}
      >
        <Link href="/journal/today" className={startLink}>
          <Plus strokeWidth={1.5} aria-hidden /> New entry
        </Link>
      </PageHeader>

      {!hasAny ? (
        <EmptyState
          title="Your journal is empty."
          description="Open today's entry to write the first line."
        >
          <Link href="/journal/today" className={startLink}>
            <Plus strokeWidth={1.5} aria-hidden /> New entry
          </Link>
        </EmptyState>
      ) : (
        <>
          <section aria-label="Today" className="mb-6">
            <h2 className="pb-2 type-label-caps text-muted-foreground">Today</h2>
            {todayEntry ? (
              <ul className="border-t border-border">
                <JournalRow entry={todayEntry} />
              </ul>
            ) : (
              <Link
                href="/journal/today"
                className="flex min-h-row-touch items-center gap-2 border-y border-border px-3 py-2 transition-colors duration-[120ms] hover:bg-accent md:min-h-row md:py-1"
              >
                <span className="type-body-md">Start today&apos;s entry</span>
                <span className="ml-auto type-data-sm text-muted-foreground">
                  {target.doneCount > 0
                    ? `${target.doneCount} done so far`
                    : journalTitle(target.date)}
                </span>
              </Link>
            )}
          </section>

          {rest.length > 0 || page.next ? <JournalList initial={rest} next={page.next} /> : null}

          {archived.items.length > 0 ? (
            <details className="group mt-8">
              <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
                  strokeWidth={1.5}
                  aria-hidden
                />
                Archived
                <span className="type-data-sm">{archived.items.length}</span>
              </summary>
              <ul className="border-t border-border" aria-label="Archived entries">
                {archived.items.map((entry) => (
                  <JournalRow key={entry.id} entry={entry} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </PageContainer>
  );
}
