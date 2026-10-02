"use client";

import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowUp, Ellipsis, ExternalLink, Trash2 } from "lucide-react";
import { CheckButton } from "@/components/ui/check-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOverride } from "@/hooks/use-override";
import type { TaskDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";
import { ProjectToken, TagBadge } from "@/components/workspace/tokens";
import { DueChip } from "./due-chip";
import { PriorityGlyph } from "./priority-glyph";
import { archiveWithUndo, completeWithUndo, reopenTask, trashWithUndo } from "./task-actions";
import { useTaskContext } from "./task-context";

type Props = {
  task: TaskDTO;
  selected?: boolean;
  onOpen: (id: string) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMove?: (id: string, direction: -1 | 1) => void;
  /** Leave the project token out where the project is already obvious (a project page). */
  hideProject?: boolean;
};

/**
 * The most repeated object in the app, and the only task row: lists, Today and search all use it.
 * Click the box to complete, the title to open. Completing is instant and the row stays where it
 * is until the Undo toast closes.
 */
export function TaskRow({
  task,
  selected,
  onOpen,
  canMoveUp,
  canMoveDown,
  onMove,
  hideProject,
}: Props) {
  const router = useRouter();
  const { prefs, nowMs } = useTaskContext();
  const [done, setDone] = useOverride(task.status === "DONE");
  const cancelled = task.status === "CANCELLED";
  const closed = done || cancelled;
  const refresh = () => router.refresh();

  function toggle(next: boolean) {
    if (next) void completeWithUndo({ id: task.id, setDone, refresh });
    else void reopenTask({ id: task.id, setDone, refresh });
  }

  return (
    <li
      data-task-id={task.id}
      className={cn(
        "group border-b border-border transition-colors duration-[120ms]",
        selected ? "bg-primary-subtle" : "hover:bg-accent",
      )}
    >
      <div className="flex min-h-row-touch items-center gap-2 pr-1 pl-3 md:min-h-row">
        <CheckButton
          checked={done}
          onCheckedChange={toggle}
          label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
          disabled={cancelled}
        />

        <button
          type="button"
          data-row-focus
          onClick={() => onOpen(task.id)}
          className="flex min-w-0 flex-1 items-center gap-2 self-stretch text-left text-[16px] md:text-[14px]"
        >
          {task.emoji ? (
            <span aria-hidden className="shrink-0">
              {task.emoji}
            </span>
          ) : null}
          <span className={cn("truncate", closed && "text-muted-foreground line-through")}>
            {task.title}
          </span>
          {cancelled ? (
            <span className="shrink-0 type-body-sm text-muted-foreground">Cancelled</span>
          ) : null}
        </button>

        <div className="flex shrink-0 items-center gap-3 pl-2">
          {task.dueDate ? (
            <DueChip
              dueDate={task.dueDate}
              dueTime={task.dueTime}
              status={done ? "DONE" : task.status}
              prefs={prefs}
              nowMs={nowMs}
            />
          ) : null}
          {!closed ? <PriorityGlyph priority={task.priority} /> : null}
          {task.subtaskTotal > 0 ? (
            <span className="type-data-sm text-muted-foreground">
              <span className="sr-only">Subtasks done: </span>
              {task.subtaskDone}/{task.subtaskTotal}
            </span>
          ) : null}
          {task.project && !hideProject ? (
            <span className="hidden max-w-32 sm:inline-flex">
              <span className="sr-only">Project: </span>
              <ProjectToken project={task.project} />
            </span>
          ) : null}
          {task.tags.length > 0 ? (
            <span className="hidden items-center gap-1 md:inline-flex">
              <span className="sr-only">Tags: </span>
              {task.tags.slice(0, 2).map((tag) => (
                <TagBadge key={tag.id} tag={tag} className="max-w-24" />
              ))}
              {task.tags.length > 2 ? (
                <span className="type-body-sm text-muted-foreground">+{task.tags.length - 2}</span>
              ) : null}
            </span>
          ) : null}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`More actions for ${task.title}`}
            className={cn(
              "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground md:size-8",
              "hover:bg-secondary hover:text-foreground",
              "data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
            )}
          >
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onOpen(task.id)}>
              <ExternalLink strokeWidth={1.5} aria-hidden /> Open
            </DropdownMenuItem>
            {onMove ? (
              <>
                <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove(task.id, -1)}>
                  <ArrowUp strokeWidth={1.5} aria-hidden /> Move up
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove(task.id, 1)}>
                  <ArrowDown strokeWidth={1.5} aria-hidden /> Move down
                </DropdownMenuItem>
              </>
            ) : null}
            <DropdownMenuItem
              onSelect={() => void archiveWithUndo({ id: task.id, archived: task.archived })}
            >
              <Archive strokeWidth={1.5} aria-hidden /> {task.archived ? "Unarchive" : "Archive"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => void trashWithUndo({ id: task.id })}
            >
              <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}
