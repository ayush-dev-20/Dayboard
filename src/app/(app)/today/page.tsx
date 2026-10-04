import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { EmptyState } from "@/components/layout/empty-state";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { buttonVariants } from "@/components/ui/button";
import { AiSuggestionSlot } from "@/components/today/ai-suggestion-slot";
import { CollapsibleSection } from "@/components/today/collapsible-section";
import { DayProgress } from "@/components/today/day-progress";
import { FocusHero } from "@/components/today/focus-hero";
import { PlanDay } from "@/components/today/plan-day";
import { TodayCapture } from "@/components/today/today-capture";
import {
  SectionHeading,
  TodayCompleted,
  TodayTasks,
  TodayTodos,
} from "@/components/today/today-lists";
import { TodayRail } from "@/components/today/today-rail";
import { checklistCounts } from "@/db/queries/onboarding";
import { getTodayData } from "@/db/queries/today";
import { GettingStarted } from "@/components/today/checklist";
import { deriveChecklist } from "@/lib/onboarding/checklist";
import { formatLongDate, greetingFor } from "@/lib/dates/greeting";
import { getPreferences } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import type { TaskDTO } from "@/lib/tasks/dto";
import { TODAY_LIMITS } from "@/lib/today/buckets";

export const metadata: Metadata = { title: "Today" };

/** Up to three one-click focus suggestions from lists Today already loaded (no extra query). */
function focusSuggestions(overdue: TaskDTO[], planning: TaskDTO[], today: TaskDTO[]): TaskDTO[] {
  const seen = new Set<string>();
  const out: TaskDTO[] = [];
  for (const task of [...overdue, ...planning, ...today]) {
    if (seen.has(task.id)) continue;
    seen.add(task.id);
    out.push(task);
    if (out.length === 3) break;
  }
  return out;
}

// The default page after sign-in (feature 07 §7.1). One loader, parallel queries. Two columns at
// ≥ 1280px (main and a 320px rail); one below, with the rail under the lists. Everything here works
// with AI switched off.
export default async function TodayPage() {
  const user = await requireUser({ redirect: true });
  const prefs = await getPreferences(user.id);
  const { dayPrefs, now, context } = await loadTaskContext(user.id);
  const [data, counts] = await Promise.all([
    getTodayData(user.id, dayPrefs, prefs.focusTaskId, now),
    prefs.checklistDismissedAt ? Promise.resolve(null) : checklistCounts(user.id),
  ]);
  const checklist = counts ? deriveChecklist(counts) : null;
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;

  const completedCount = data.completedTasks.length + data.completedTodos.length;
  const dayIsClear =
    data.overdue.length === 0 &&
    data.today.length === 0 &&
    data.todos.length === 0 &&
    data.planning.length === 0;
  const upNext = data.today.slice(data.laterStart);

  return (
    <TaskContextProvider value={context}>
      <PageContainer width="wide">
        <div className="xl:grid xl:grid-cols-[minmax(0,720px)_var(--spacing-today-rail)] xl:justify-between xl:gap-12">
          <div className="min-w-0">
            <PageHeader
              title={`${greetingFor(now, dayPrefs.timezone)}, ${firstName}`}
              description={formatLongDate(now, dayPrefs.timezone)}
              size="display"
              sticky={false}
              visibleOnPhone
              className="mb-8 items-center"
            >
              <PlanDay focusId={data.focus?.id ?? null} />
              <DayProgress done={data.progress.done} total={data.progress.total} />
            </PageHeader>

            <TodayCapture />

            <div className="mt-6 flex flex-col gap-4">
              <FocusHero
                focus={data.focus}
                suggestions={focusSuggestions(data.overdue, data.planning, data.today)}
              />
              <AiSuggestionSlot overdueCount={data.overdueTotal} />
            </div>

            {dayIsClear ? (
              <EmptyState
                className="mt-4"
                illustration="today-clear"
                title="Your day is clear."
                description="Capture a task or start a note."
              >
                <Link href="/tasks?focus=add" className={buttonVariants()}>
                  <Plus strokeWidth={1.5} aria-hidden /> New task
                </Link>
                <Link href="/notes/new" className={buttonVariants({ variant: "secondary" })}>
                  New note
                </Link>
              </EmptyState>
            ) : null}

            <div className="mt-10 flex flex-col gap-10">
              {data.overdue.length > 0 ? (
                <CollapsibleSection
                  id="today-overdue"
                  label="Overdue"
                  count={data.overdueTotal}
                  alarm
                >
                  <TodayTasks tasks={data.overdue} />
                  {data.overdueTotal > TODAY_LIMITS.overdue ? (
                    <Link
                      href="/tasks?due=overdue"
                      className={`${buttonVariants({ variant: "secondary" })} mt-2`}
                    >
                      Show all {data.overdueTotal}
                    </Link>
                  ) : null}
                </CollapsibleSection>
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

          <div className="mt-12 xl:mt-0">
            <TodayRail
              upNext={upNext}
              notes={data.notes}
              inbox={data.inbox}
              now={now}
              timeZone={dayPrefs.timezone}
              checklist={checklist ? <GettingStarted checklist={checklist} /> : null}
            />
          </div>
        </div>
      </PageContainer>
    </TaskContextProvider>
  );
}
