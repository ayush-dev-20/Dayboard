import { EmptyState } from "@/components/layout/empty-state";
import { NewItemButton } from "@/components/tasks/new-item-button";
import { TodoAddRow } from "@/components/tasks/todo-add-row";
import { TodoList } from "@/components/tasks/todo-list";
import { ViewTabs } from "@/components/tasks/view-tabs";
import { listCompletedTodosSince, listOpenTodos } from "@/db/queries/todos";
import { startOfUserDay, type DayPrefs } from "@/lib/dates/today";
import { PageHeader } from "@/components/layout/page-header";
import { PageContainer } from "@/components/layout/page-container";

export async function TodosView({
  userId,
  dayPrefs,
  now,
}: {
  userId: string;
  dayPrefs: DayPrefs;
  now: Date;
}) {
  const [open, completed] = await Promise.all([
    listOpenTodos(userId),
    listCompletedTodosSince(userId, startOfUserDay(dayPrefs, now)),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Tasks"
        description={`${open.length} open ${open.length === 1 ? "todo" : "todos"}`}
      >
        <NewItemButton label="New todo" />
      </PageHeader>

      <ViewTabs active="todos" />
      <div className="mt-2">
        <TodoAddRow />
      </div>

      <div className="mt-8">
        {open.length === 0 && completed.length === 0 ? (
          <EmptyState
            illustration="tasks-empty"
            title="No todos yet."
            description="Add one above, or press T."
          />
        ) : (
          <TodoList open={open} completed={completed} />
        )}
        <p className="mt-6 type-body-md text-muted-foreground">
          Todos are quick checkboxes. They have no priority, subtasks or tags.
        </p>
      </div>
    </PageContainer>
  );
}
