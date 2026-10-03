import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/layout/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { NewItemButton } from "@/components/tasks/new-item-button";
import { TaskAddRow } from "@/components/tasks/task-add-row";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { TaskFilters } from "@/components/tasks/task-filters";
import { TaskList, type TaskGroupData } from "@/components/tasks/task-list";
import { TaskListShell } from "@/components/tasks/task-list-shell";
import { ViewTabs } from "@/components/tasks/view-tabs";
import { countTasksByGroup, getTaskDetail, listClosedTasks, listTasks } from "@/db/queries/tasks";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { applyDueFilter, GROUP_LABELS, groupTasks } from "@/lib/tasks/grouping";
import { hasActiveFilters, parseTasksParams } from "@/lib/tasks/params";
import { isOpenStatus } from "@/lib/tasks/status";
import { TodosView } from "./todos-view";
import { PageHeader } from "@/components/layout/page-header";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const params = parseTasksParams(await searchParams);
  const { dayPrefs, now, context } = await loadTaskContext(user.id);

  if (params.view === "todos") {
    return (
      <TaskContextProvider value={context}>
        <TodosView userId={user.id} dayPrefs={dayPrefs} now={now} />
      </TaskContextProvider>
    );
  }

  const openStatuses = params.statuses.filter(isOpenStatus);
  const closedStatuses = params.statuses.filter((s) => !isOpenStatus(s));
  const showingClosed = closedStatuses.length > 0;

  const scope = { projectId: params.projectId ?? undefined, tagId: params.tagId ?? undefined };
  const [open, closed, counts, detail] = await Promise.all([
    listTasks(user.id, { statuses: openStatuses, archived: params.archived, ...scope }),
    params.due === "any"
      ? listClosedTasks(user.id, {
          statuses: showingClosed ? closedStatuses : ["DONE"],
          archived: params.archived,
          ...scope,
        })
      : Promise.resolve([]),
    countTasksByGroup(user.id, { archived: params.archived, ...scope }),
    params.taskId ? getTaskDetail(user.id, params.taskId) : Promise.resolve(null),
  ]);

  const grouped = groupTasks(open, dayPrefs, now);
  const groups: TaskGroupData[] = applyDueFilter(grouped, params.due).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    tasks: grouped[key],
  }));

  const nothingAtAll = counts.open === 0 && counts.done === 0 && !hasActiveFilters(params);
  const noMatches = groups.length === 0 && closed.length === 0 && hasActiveFilters(params);
  const sheetOpen = Boolean(detail);

  return (
    <TaskContextProvider value={context}>
      <TaskListShell sheetOpen={sheetOpen}>
        <PageHeader
          title="Tasks"
          description={`${counts.open} open${params.archived ? " (archived)" : ""}`}
        >
          <NewItemButton label="New task" />
        </PageHeader>

        <ViewTabs active="tasks" />
        <TaskFilters params={params} />
        <TaskAddRow />

        <div className="mt-8">
          {nothingAtAll ? (
            <EmptyState
              illustration="tasks-empty"
              title="No tasks yet."
              description="Add one above, or press N."
            >
              <Link href="/inbox" className={buttonVariants({ variant: "secondary" })}>
                Go to Inbox
              </Link>
            </EmptyState>
          ) : noMatches ? (
            <EmptyState
              title="No tasks match these filters."
              description="Nothing is hidden or deleted."
            >
              <Link href="/tasks" className={buttonVariants({ variant: "secondary" })}>
                Clear filters
              </Link>
            </EmptyState>
          ) : (
            <TaskList
              groups={groups}
              closed={closed}
              doneCount={params.due === "any" ? counts.done : 0}
              selectedId={detail?.id ?? null}
              completedOpenByDefault={showingClosed}
            />
          )}
        </div>
      </TaskListShell>
      {detail ? <TaskDetailSheet detail={detail} /> : null}
    </TaskContextProvider>
  );
}
