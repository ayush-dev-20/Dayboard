"use client";

import { handleRowKeys } from "@/components/tasks/row-keys";
import { TaskRow } from "@/components/tasks/task-row";
import { TodoRow } from "@/components/tasks/todo-row";
import { useOpenTask } from "@/components/tasks/use-open-task";
import type { TaskDTO, TodoDTO } from "@/lib/tasks/dto";

/** Same section heading as the Tasks list: small caps and a count. */
export function SectionHeading({
  id,
  label,
  count,
}: {
  id: string;
  label: string;
  count?: number;
}) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground">
      {label}
      {count !== undefined ? <span className="type-data-sm">{count}</span> : null}
    </h2>
  );
}

/**
 * Task rows for a Today section. They are the same `TaskRow` as everywhere, so completing here
 * works exactly as on the Tasks page (instant, with Undo). Up/Down/Space/Enter work as in the list.
 * `subheadingAt` puts a small heading above the row at that index ("Scheduled later today").
 */
export function TodayTasks({
  tasks,
  subheading,
  subheadingAt,
}: {
  tasks: TaskDTO[];
  subheading?: string;
  subheadingAt?: number;
}) {
  const open = useOpenTask();
  const split =
    subheading !== undefined && subheadingAt !== undefined && subheadingAt < tasks.length;

  const rows = (list: TaskDTO[]) => (
    <ul className="border-t border-border">
      {list.map((task) => (
        <TaskRow key={task.id} task={task} onOpen={open} />
      ))}
    </ul>
  );

  return (
    <div onKeyDown={(event) => handleRowKeys(event, { idAttribute: "task-id", onMove: () => {} })}>
      {split ? (
        <>
          {subheadingAt! > 0 ? rows(tasks.slice(0, subheadingAt)) : null}
          <p className="mt-4 pb-2 type-label-caps text-muted-foreground">{subheading}</p>
          {rows(tasks.slice(subheadingAt))}
        </>
      ) : (
        rows(tasks)
      )}
    </div>
  );
}

export function TodayTodos({ todos }: { todos: TodoDTO[] }) {
  return (
    <div onKeyDown={(event) => handleRowKeys(event, { idAttribute: "todo-id", onMove: () => {} })}>
      <ul className="border-t border-border">
        {todos.map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </ul>
    </div>
  );
}

/** Finished today: tasks and todos together, most recent first. */
export function TodayCompleted({ tasks, todos }: { tasks: TaskDTO[]; todos: TodoDTO[] }) {
  const open = useOpenTask();
  const items = [
    ...tasks.map((t) => ({ kind: "task" as const, at: t.completedAt ?? "", task: t })),
    ...todos.map((t) => ({ kind: "todo" as const, at: t.completedAt ?? "", todo: t })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20);

  return (
    <ul className="border-t border-border">
      {items.map((item) =>
        item.kind === "task" ? (
          <TaskRow key={item.task.id} task={item.task} onOpen={open} />
        ) : (
          <TodoRow key={item.todo.id} todo={item.todo} />
        ),
      )}
    </ul>
  );
}
