import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/layout/page-header";
import { NewItemButton } from "@/components/tasks/new-item-button";
import { TaskContextProvider } from "@/components/tasks/task-context";
import { TaskDetailSheet } from "@/components/tasks/task-detail-sheet";
import { TaskListShell } from "@/components/tasks/task-list-shell";
import { ViewTabs } from "@/components/tasks/view-tabs";
import { TasksCollection, TodosCollection } from "@/components/views/collections";
import { countTasksByGroup, getTaskDetail } from "@/db/queries/tasks";
import { countOpenTodos } from "@/db/queries/todos";
import { getViews, loadViewItems } from "@/db/queries/views";
import type { SearchParams } from "@/lib/oauth-providers";
import { requireUser } from "@/lib/session";
import { loadTaskContext } from "@/lib/tasks/context";
import { parseTasksParams } from "@/lib/tasks/params";
import type { ViewTask, ViewTodo } from "@/lib/views/items";
import { lastViewCookie, pickView } from "@/lib/views/legacy";
import { quickFilters } from "@/lib/views/quick";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser({ redirect: true });
  const params = parseTasksParams(await searchParams);
  const { dayPrefs, now, weekStart, context } = await loadTaskContext(user.id);
  const [taskViews, todoViews] = await Promise.all([
    getViews(user.id, "TASKS"),
    getViews(user.id, "TODOS"),
  ]);
  const jar = await cookies();
  const engine = { nowMs: now.getTime(), weekStart, prefs: dayPrefs };

  // `?view=todos` is V1's switch; a saved view id says which collection it belongs to.
  const isTodos =
    params.view === "todos" ||
    (params.viewId !== null && todoViews.some((v) => v.id === params.viewId));

  if (isTodos) {
    const param = params.viewId
      ? ({ kind: "id", id: params.viewId } as const)
      : ({ kind: "none" } as const);
    const { view } = pickView(todoViews, param, jar.get(lastViewCookie("TODOS"))?.value ?? null);
    const [items, openCount] = await Promise.all([
      loadViewItems(user.id, "TODOS", view, [], null),
      countOpenTodos(user.id),
    ]);
    return (
      <TaskContextProvider value={context}>
        <PageContainer width={view.type === "LIST" ? "content" : "wide"}>
          <PageHeader
            title="Tasks"
            description={`${openCount} open ${openCount === 1 ? "todo" : "todos"}`}
          >
            <NewItemButton label="New todo" />
          </PageHeader>
          <ViewTabs active="todos" />
          <TodosCollection
            views={todoViews}
            activeViewId={view.id}
            items={items as ViewTodo[]}
            quick={[]}
            engine={engine}
            basePath="/tasks"
          />
        </PageContainer>
      </TaskContextProvider>
    );
  }

  const param = params.viewId
    ? ({ kind: "id", id: params.viewId } as const)
    : ({ kind: "none" } as const);
  const { view } = pickView(taskViews, param, jar.get(lastViewCookie("TASKS"))?.value ?? null);
  const quick = quickFilters({
    statuses: params.statuses,
    due: params.due,
    archived: params.archived,
    projectId: params.projectId,
    tagId: params.tagId,
  });
  const scope = { projectId: params.projectId ?? undefined, tagId: params.tagId ?? undefined };
  const [items, counts, detail] = await Promise.all([
    loadViewItems(user.id, "TASKS", view, quick, null),
    countTasksByGroup(user.id, { archived: params.archived, ...scope }),
    params.taskId ? getTaskDetail(user.id, params.taskId) : Promise.resolve(null),
  ]);

  return (
    <TaskContextProvider value={context}>
      <TaskListShell sheetOpen={Boolean(detail)} wide={view.type !== "LIST"}>
        <PageHeader
          title="Tasks"
          description={`${counts.open} open${params.archived ? " (archived)" : ""}`}
        >
          <NewItemButton label="New task" />
        </PageHeader>
        <ViewTabs active="tasks" />
        <TasksCollection
          views={taskViews}
          activeViewId={view.id}
          items={items as ViewTask[]}
          params={params}
          quick={quick}
          counts={counts}
          selectedId={detail?.id ?? null}
          engine={engine}
          basePath="/tasks"
        />
      </TaskListShell>
      {detail ? <TaskDetailSheet detail={detail} /> : null}
    </TaskContextProvider>
  );
}
