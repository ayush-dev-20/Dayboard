"use client";

import { AnimatePresence } from "motion/react";
import { animateRows } from "@/lib/motion";

import { handleRowKeys } from "@/components/tasks/row-keys";
import { TaskRow } from "@/components/tasks/task-row";
import { TodoRow } from "@/components/tasks/todo-row";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { useTaskContext } from "@/components/tasks/task-context";
import type { TaskDTO, TodoDTO } from "@/lib/tasks/dto";
import { oldestOverdueId } from "@/lib/tasks/overdue";
import { cn } from "@/lib/utils";

/** Same section heading as the Tasks list: small caps and a count. */
export function SectionHeading({
  id,
  label,
  count,
  alarm,
}: {
  id: string;
  label: string;
  count?: number;
  /** The Overdue header carries the alarm: its count is red (DESIGN.md: red is rare). */
  alarm?: boolean;
}) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground">
      {label}
      {count !== undefined ? (
        <span className={cn("type-data-sm", alarm && "text-destructive")}>{count}</span>
      ) : null}
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
  const { prefs, nowMs } = useTaskContext();
  const oldest = oldestOverdueId(tasks, prefs, new Date(nowMs));
  const split =
    subheading !== undefined && subheadingAt !== undefined && subheadingAt < tasks.length;

  const rows = (list: TaskDTO[]) => (
    <ul className="border-t border-border">
      <AnimatePresence initial={false}>
        {list.map((task) => (
          <TaskRow
            layoutAnimation={animateRows(list.length)}
            key={task.id}
            task={task}
            onOpen={open}
            overdueEmphasis={task.id === oldest}
          />
        ))}
      </AnimatePresence>
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
  const { prefs, nowMs } = useTaskContext();
  const oldest = oldestOverdueId(
    todos.map((t) => ({
      id: t.id,
      status: t.isComplete ? "DONE" : "PLANNED",
      dueDate: t.dueDate,
      dueTime: null,
    })),
    prefs,
    new Date(nowMs),
  );
  return (
    <div onKeyDown={(event) => handleRowKeys(event, { idAttribute: "todo-id", onMove: () => {} })}>
      <ul className="border-t border-border">
        <AnimatePresence initial={false}>
          {todos.map((todo) => (
            <TodoRow
              layoutAnimation={animateRows(todos.length)}
              key={todo.id}
              todo={todo}
              overdueEmphasis={todo.id === oldest}
            />
          ))}
        </AnimatePresence>
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
      <AnimatePresence initial={false}>
        {items.map((item) =>
          item.kind === "task" ? (
            <TaskRow key={item.task.id} task={item.task} onOpen={open} />
          ) : (
            <TodoRow key={item.todo.id} todo={item.todo} />
          ),
        )}
      </AnimatePresence>
    </ul>
  );
}
