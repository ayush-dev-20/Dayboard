"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { CheckButton } from "@/components/ui/check-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOverride } from "@/hooks/use-override";
import type { TodoDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";
import { DueChip } from "./due-chip";
import { useTaskContext } from "./task-context";
import { archiveTodoWithUndo, toggleTodoWithUndo, trashTodoWithUndo } from "./todo-actions";
import { TodoEditDialog } from "./todo-edit-dialog";

type Props = {
  todo: TodoDTO;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (id: string, direction: -1 | 1) => void;
};

/**
 * A todo is a circular checkbox, an emoji, a title, an optional due date and an overflow menu.
 * Nothing else: no subtasks, priority, tags or description (those are what Tasks are for).
 */
export function TodoRow({ todo, canMoveUp, canMoveDown, onMove }: Props) {
  const router = useRouter();
  const { prefs, nowMs } = useTaskContext();
  const [done, setDone] = useOverride(todo.isComplete);
  const [editing, setEditing] = useState(false);

  return (
    <li
      data-todo-id={todo.id}
      className="group border-b border-border transition-colors duration-[120ms] hover:bg-accent"
    >
      <div className="flex min-h-row-touch items-center gap-2 pr-1 pl-3 md:min-h-row">
        <CheckButton
          shape="round"
          checked={done}
          onCheckedChange={(next) =>
            void toggleTodoWithUndo({ id: todo.id, next, setDone, refresh: () => router.refresh() })
          }
          label={done ? `Reopen ${todo.title}` : `Complete ${todo.title}`}
        />

        <button
          type="button"
          data-row-focus
          onClick={() => setEditing(true)}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left text-[16px] md:text-[14px]"
        >
          {todo.emoji ? (
            <span aria-hidden className="shrink-0">
              {todo.emoji}
            </span>
          ) : null}
          <span className={cn("truncate", done && "text-muted-foreground line-through")}>
            {todo.title}
          </span>
        </button>

        {todo.dueDate ? (
          <DueChip
            dueDate={todo.dueDate}
            dueTime={null}
            status={done ? "DONE" : "PLANNED"}
            prefs={prefs}
            nowMs={nowMs}
          />
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`More actions for ${todo.title}`}
            className={cn(
              "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground md:size-8",
              "hover:bg-secondary hover:text-foreground",
              "data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
            )}
          >
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil strokeWidth={1.5} aria-hidden /> Edit
            </DropdownMenuItem>
            {onMove ? (
              <>
                <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove(todo.id, -1)}>
                  <ArrowUp strokeWidth={1.5} aria-hidden /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove(todo.id, 1)}>
                  <ArrowDown strokeWidth={1.5} aria-hidden /> Move down
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem onSelect={() => void archiveTodoWithUndo({ id: todo.id })}>
              <Archive strokeWidth={1.5} aria-hidden /> Archive
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => void trashTodoWithUndo({ id: todo.id })}
            >
              <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <TodoEditDialog todo={todo} open={editing} onOpenChange={setEditing} />
    </li>
  );
}
