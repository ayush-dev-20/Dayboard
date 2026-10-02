import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { NoteCard } from "@/components/notes/note-card";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { buttonVariants } from "@/components/ui/button";
import { AiSuggestionSlot } from "@/components/today/ai-suggestion-slot";
import { OverdueCleanup } from "@/components/today/overdue-cleanup";
import { FocusCard } from "@/components/today/focus-card";
import { TodayCapture } from "@/components/today/today-capture";
import {
  SectionHeading,
  TodayCompleted,
  TodayTasks,
  TodayTodos,
} from "@/components/today/today-lists";
import { getTodayData } from "@/db/queries/today";
import { formatLongDate, greetingFor } from "@/lib/dates/greeting";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { TODAY_LIMITS } from "@/lib/today/buckets";

export const metadata: Metadata = { title: "Today" };

// The default page after sign-in. One loader, parallel queries, no client fetching. Everything
// here works with AI switched off.
export default async function TodayPage() {
  const user = await requireUser({ redirect: true });
  const prefs = await getPreferences(user.id);
  const { dayPrefs, now, context } = await loadTaskContext(user.id);
  const data = await getTodayData(user.id, dayPrefs, prefs.focusTaskId, now);
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  const completedCount = data.completedTasks.length + data.completedTodos.length;
  const dayIsClear =
    data.overdue.length === 0 &&
    data.today.length === 0 &&
    data.todos.length === 0 &&
    data.planning.length === 0;

  return (
    <TaskContextProvider value={context}>
      <div className="max-w-content">
        <header className="mb-8">
          <h1 className="type-headline-lg text-foreground md:type-display">
            {greetingFor(now, dayPrefs.timezone)}, {firstName}
          </h1>
          <p className="mt-2 type-body-lg text-muted-foreground">
            {formatLongDate(now, dayPrefs.timezone)}
          </p>
        </header>

        <TodayCapture />

        <div className="mt-6">
          <FocusCard focus={data.focus} />
        </div>

        <AiSuggestionSlot />

        {dayIsClear ? (
          <EmptyState
            className="mt-8"
            title="Your day is clear."
            description="Capture a task or start a note."
          >
            <Link href="/tasks?focus=add" className={buttonVariants()}>
              New task
            </Link>
            <Link href="/notes/new" className={buttonVariants({ variant: "secondary" })}>
              New note
            </Link>
          </EmptyState>
        ) : null}

        <div className="mt-10 flex flex-col gap-10">
          {data.overdue.length > 0 ? (
            <section aria-labelledby="today-overdue">
              <div className="flex items-baseline justify-between gap-4">
                <SectionHeading id="today-overdue" label="Overdue" count={data.overdueTotal} />
                <OverdueCleanup />
              </div>
              <TodayTasks tasks={data.overdue} />
              {data.overdueTotal > TODAY_LIMITS.overdue ? (
                <Link
                  href="/tasks?due=overdue"
                  className="mt-2 inline-flex h-11 items-center type-body-md text-primary underline underline-offset-2 md:h-8"
                >
                  Show all {data.overdueTotal}
                </Link>
              ) : null}
            </section>
          ) : null}

          {data.today.length > 0 ? (
            <section aria-labelledby="today-today">
              <SectionHeading id="today-today" label="Today" count={data.today.length} />
              <TodayTasks
                tasks={data.today}
                subheading="Scheduled later today"
                subheadingAt={data.laterStart}
              />
            </section>
          ) : null}

          {data.todos.length > 0 ? (
            <section aria-labelledby="today-todos">
              <SectionHeading id="today-todos" label="Todos" count={data.todos.length} />
              <TodayTodos todos={data.todos} />
            </section>
          ) : null}

          {data.planning.length > 0 ? (
            <section aria-labelledby="today-planning">
              <SectionHeading
                id="today-planning"
                label="Needs planning"
                count={data.planning.length}
              />
              <TodayTasks tasks={data.planning} />
            </section>
          ) : null}

          {data.notes.length > 0 ? (
            <section aria-labelledby="today-notes">
              <SectionHeading
                id="today-notes"
                label="Recently updated notes"
                count={data.notes.length}
              />
              <ul className="border-t border-border">
                {data.notes.map((note) => (
                  <NoteCard key={note.id} note={note} now={now} timeZone={dayPrefs.timezone} />
                ))}
              </ul>
            </section>
          ) : null}

          {completedCount > 0 ? (
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-2 pb-2 type-label-caps text-muted-foreground [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 transition-transform duration-[120ms] group-open:rotate-90"
                  strokeWidth={1.5}
                  aria-hidden
                />
                Completed today
                <span className="type-data-sm">{completedCount}</span>
              </summary>
              <TodayCompleted tasks={data.completedTasks} todos={data.completedTodos} />
            </details>
          ) : null}
        </div>
      </div>
    </TaskContextProvider>
  );
}
