"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { reorderTask } from "@/actions/tasks";
import type { GroupKey } from "@/lib/tasks/grouping";
import type { TaskDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";
import { handleRowKeys } from "./row-keys";
import { TaskRow } from "./task-row";
import { useOpenTask } from "./use-open-task";

export type TaskGroupData = { key: GroupKey; label: string; tasks: TaskDTO[] };

type Props = {
  groups: TaskGroupData[];
  closed: TaskDTO[];
  /** Total completed tasks (the list only loads the most recent). */
  doneCount: number;
  selectedId: string | null;
  completedOpenByDefault: boolean;
};

function Heading({ id, label, count }: { id: string; label: string; count: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground">
      {label}
      <span className="type-data-sm">{count}</span>
    </h2>
  );
}

/**
 * Open tasks in groups (Overdue, Today, Upcoming, No date) and a collapsed Completed section.
 * Keyboard: Up/Down move between rows, Space toggles, Enter opens, Alt+Up/Down reorders within a group.
 */
export function TaskList({ groups, closed, doneCount, selectedId, completedOpenByDefault }: Props) {
  const open = useOpenTask();
  const [completedOpen, setCompletedOpen] = useState(completedOpenByDefault);
  const focusAfter = useRef<string | null>(null);

  const orderKey = groups.map((g) => g.tasks.map((t) => t.id).join(",")).join("|");
  useEffect(() => {
    if (!focusAfter.current) return;
    document
      .querySelector<HTMLElement>(`[data-task-id="${focusAfter.current}"] [data-row-focus]`)
      ?.focus();
    focusAfter.current = null;
  }, [orderKey]);

  async function move(group: TaskDTO[], id: string, direction: -1 | 1) {
    const index = group.findIndex((t) => t.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= group.length) return;

    // `beforeId` is what will sit just above the moved task, `afterId` just below.
    const beforeId = direction === -1 ? (group[index - 2]?.id ?? null) : group[index + 1]!.id;
    const afterId = direction === -1 ? group[index - 1]!.id : (group[index + 2]?.id ?? null);

    focusAfter.current = id;
    const result = await reorderTask({ id, beforeId, afterId });
    if (!result.ok) {
      focusAfter.current = null;
      toast.error("Couldn't move that task. Try again.");
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    handleRowKeys(event, {
      idAttribute: "task-id",
      onMove: (id, direction) => {
        const group = groups.find((g) => g.tasks.some((t) => t.id === id));
        if (group) void move(group.tasks, id, direction);
      },
    });
  }

  return (
    // The list handles keys for all its rows; each row's title button is the focus target.
    <div data-task-list onKeyDown={onKeyDown}>
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`group-${group.key}`} className="mt-8 first:mt-0">
          <Heading id={`group-${group.key}`} label={group.label} count={group.tasks.length} />
          <ul className="border-t border-border">
            {group.tasks.map((task, index) => (
              <TaskRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onOpen={open}
                canMoveUp={index > 0}
                canMoveDown={index < group.tasks.length - 1}
                onMove={(id, direction) => void move(group.tasks, id, direction)}
              />
            ))}
          </ul>
        </section>
      ))}

      {doneCount > 0 || closed.length > 0 ? (
        <section aria-labelledby="group-completed" className="mt-8">
          <h2 id="group-completed" className="pb-2 type-label-caps text-muted-foreground">
            <button
              type="button"
              aria-expanded={completedOpen}
              onClick={() => setCompletedOpen((v) => !v)}
              className="flex items-center gap-2 rounded-sm type-label-caps"
            >
              <ChevronRight
                className={cn(
                  "size-4 transition-transform duration-[120ms]",
                  completedOpen && "rotate-90",
                )}
                strokeWidth={1.5}
                aria-hidden
              />
              Completed
              <span className="type-data-sm">{doneCount > 0 ? doneCount : closed.length}</span>
            </button>
          </h2>
          {completedOpen ? (
            <ul className="border-t border-border">
              {closed.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  selected={task.id === selectedId}
                  onOpen={open}
                />
              ))}
            </ul>
          ) : (
            <div className="border-t border-border" />
          )}
        </section>
      ) : null}
    </div>
  );
}
