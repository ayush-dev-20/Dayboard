"use client";

import { AnimatePresence } from "motion/react";
import { animateRows } from "@/lib/motion";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { reorderTodo } from "@/actions/todos";
import type { TodoDTO } from "@/lib/tasks/dto";
import { handleRowKeys } from "./row-keys";
import { TodoRow } from "./todo-row";
import { useTaskContext } from "./task-context";
import { oldestOverdueId } from "@/lib/tasks/overdue";

type Props = { open: TodoDTO[]; completed: TodoDTO[]; openLabel?: string };

function Heading({ id, label, count }: { id: string; label: string; count: number }) {
  return (
    <h2 id={id} className="flex items-baseline gap-2 pb-2 type-label-caps text-muted-foreground">
      {label}
      <span className="type-data-sm">{count}</span>
    </h2>
  );
}

export function TodoList({ open, completed, openLabel = "Open" }: Props) {
  const focusAfter = useRef<string | null>(null);
  const { prefs, nowMs } = useTaskContext();
  const oldest = oldestOverdueId(
    open.map((t) => ({ id: t.id, status: "PLANNED", dueDate: t.dueDate, dueTime: null })),
    prefs,
    new Date(nowMs),
  );

  const orderKey = open.map((t) => t.id).join(",");
  useEffect(() => {
    if (!focusAfter.current) return;
    document
      .querySelector<HTMLElement>(`[data-todo-id="${focusAfter.current}"] [data-row-focus]`)
      ?.focus();
    focusAfter.current = null;
  }, [orderKey]);

  async function move(id: string, direction: -1 | 1) {
    const index = open.findIndex((t) => t.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= open.length) return;

    const beforeId = direction === -1 ? (open[index - 2]?.id ?? null) : open[index + 1]!.id;
    const afterId = direction === -1 ? open[index - 1]!.id : (open[index + 2]?.id ?? null);

    focusAfter.current = id;
    const result = await reorderTodo({ id, beforeId, afterId });
    if (!result.ok) {
      focusAfter.current = null;
      toast.error("Couldn't move that todo. Try again.");
    }
  }

  return (
    <div
      onKeyDown={(event) =>
        handleRowKeys(event, { idAttribute: "todo-id", onMove: (id, d) => void move(id, d) })
      }
    >
      {open.length > 0 ? (
        <section aria-labelledby="todos-open">
          <Heading id="todos-open" label={openLabel} count={open.length} />
          <ul className="border-t border-border">
            <AnimatePresence initial={false}>
              {open.map((todo, index) => (
                <TodoRow
                  layoutAnimation={animateRows(open.length)}
                  key={todo.id}
                  todo={todo}
                  overdueEmphasis={todo.id === oldest}
                  canMoveUp={index > 0}
                  canMoveDown={index < open.length - 1}
                  onMove={(id, direction) => void move(id, direction)}
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ) : null}

      {completed.length > 0 ? (
        <section aria-labelledby="todos-completed" className="mt-8">
          <Heading id="todos-completed" label="Completed today" count={completed.length} />
          <ul className="border-t border-border">
            <AnimatePresence initial={false}>
              {completed.map((todo) => (
                <TodoRow
                  layoutAnimation={animateRows(completed.length)}
                  key={todo.id}
                  todo={todo}
                />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      ) : null}
    </div>
  );
}
