"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { CheckButton } from "@/components/ui/check-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DueChip } from "@/components/tasks/due-chip";
import { PriorityGlyph } from "@/components/tasks/priority-glyph";
import { useTaskContext } from "@/components/tasks/task-context";
import { ProjectPicker } from "@/components/workspace/project-picker";
import { ProjectToken, TagBadge } from "@/components/workspace/tokens";
import { TagPicker } from "@/components/workspace/tag-picker";
import { formatDay } from "@/lib/dates/calendar";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/lib/tasks/status";
import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import type { MoveCommand } from "@/lib/views/move-card";
import { isoToLocalDate } from "@/lib/views/values";
import { cn } from "@/lib/utils";
import { applyEdit } from "./apply";
import { DatePopover } from "./date-popover";
import { OpenTitle } from "./item-parts";
import type { ViewState } from "./view-state";

// What each property looks like in a table row, and how it is edited in place (V2 feature 06 §5).
// Every edit is an ordinary command with Undo; the pickers are the ones used everywhere else.

const cell =
  "flex min-h-9 w-full items-center gap-1.5 rounded-sm px-2 text-left type-body-md hover:bg-accent md:min-h-8";
const empty = <span className="text-muted-foreground">—</span>;

type Props = { state: ViewState; item: AnyItem };

export function PropertyCell({ state, item, property }: Props & { property: string }) {
  const { collection } = state;
  switch (property) {
    case "title":
      return <TitleCell state={state} item={item} />;
    case "status":
      return <StatusCell state={state} item={item as ViewTask} />;
    case "priority":
      return <PriorityCell state={state} item={item as ViewTask} />;
    case "done":
      return <DoneCell state={state} item={item as ViewTodo} />;
    case "dueDate":
      return <DueCell state={state} item={item as ViewTask | ViewTodo} />;
    case "startDate":
      return <StartCell state={state} item={item as ViewTask} />;
    case "project":
      return <ProjectCell state={state} item={item} />;
    case "tags":
      return <TagsCell state={state} item={item as ViewTask | ViewNote} />;
    case "subtasks": {
      const task = item as ViewTask;
      return (
        <span className="px-2 type-data-sm text-muted-foreground">
          {task.subtaskTotal > 0 ? `${task.subtaskDone}/${task.subtaskTotal}` : "—"}
        </span>
      );
    }
    case "linkedNotes":
      return <Count value={(item as ViewTask).noteCount} />;
    case "linkedTasks":
      return <Count value={(item as ViewNote).taskCount} />;
    case "created":
    case "updated": {
      const iso = property === "created" ? item.createdAt : item.updatedAt;
      const day = isoToLocalDate(iso, state.ctx.prefs.timezone);
      const today = isoToLocalDate(new Date(state.ctx.now).toISOString(), state.ctx.prefs.timezone);
      return (
        <time dateTime={iso} className="px-2 type-data-sm text-muted-foreground">
          {formatDay(day, today)}
        </time>
      );
    }
    default:
      return collection ? empty : null;
  }
}

function Count({ value }: { value: number }) {
  return <span className="px-2 type-data-sm text-muted-foreground">{value > 0 ? value : "—"}</span>;
}

// ---- Title: opens the item; the pencil edits the title in place ---------------------------------

function TitleCell({ state, item }: Props) {
  const { collection, config } = state;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  async function commit() {
    const title = draft.trim();
    setEditing(false);
    if (!title || title === item.title) return setDraft(item.title);
    const command: MoveCommand =
      collection === "TASKS"
        ? { type: "task.title", id: item.id, title, from: item.title }
        : collection === "TODOS"
          ? { type: "todo.title", id: item.id, title, from: item.title }
          : {
              type: "note.title",
              id: item.id,
              title,
              from: item.title,
              version: (item as ViewNote).version,
            };
    const ok = await applyEdit(state, [{ item, commands: [command] }], "Title changed.");
    if (!ok) setDraft(item.title);
  }

  if (editing) {
    return (
      <input
        autoFocus
        aria-label={`Title of ${item.title}`}
        value={draft}
        maxLength={collection === "TASKS" ? 500 : 300}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(item.title);
            setEditing(false);
          }
        }}
        className="h-9 w-full rounded-sm border border-input bg-background px-2 type-body-md"
      />
    );
  }

  const closed =
    collection === "TASKS"
      ? ["DONE", "CANCELLED"].includes((item as ViewTask).status)
      : collection === "TODOS"
        ? (item as ViewTodo).isComplete
        : false;
  const emoji = (item as { emoji: string | null }).emoji;

  return (
    <div className="group/title flex min-w-0 items-center">
      <OpenTitle
        collection={collection}
        item={item}
        openIn={config.openIn}
        className={cn(cell, "min-w-0 flex-1 hover:bg-transparent hover:underline")}
      >
        {emoji ? <span aria-hidden>{emoji}</span> : null}
        <span className={cn("truncate", closed && "text-muted-foreground line-through")}>
          {item.title || "Untitled"}
        </span>
      </OpenTitle>
      <button
        type="button"
        aria-label={`Edit title of ${item.title}`}
        onClick={() => {
          setDraft(item.title);
          setEditing(true);
        }}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground opacity-0 group-focus-within/title:opacity-100 group-hover/title:opacity-100 hover:bg-accent md:size-7 [@media(hover:none)]:opacity-100"
      >
        <Pencil className="size-3.5" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

// ---- Select-like cells --------------------------------------------------------------------------

function StatusCell({ state, item }: { state: ViewState; item: ViewTask }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Status of ${item.title}: ${STATUS_LABELS[item.status]}`}
        className={cell}
      >
        {STATUS_LABELS[item.status]}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={item.status}
          onValueChange={(value) => {
            const status = value as TaskStatus;
            if (status === item.status) return;
            void applyEdit(
              state,
              [
                {
                  item,
                  commands: [{ type: "task.status", id: item.id, status, from: item.status }],
                },
              ],
              `Moved to ${STATUS_LABELS[status]}.`,
            );
          }}
        >
          {TASK_STATUSES.map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              {STATUS_LABELS[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PriorityCell({ state, item }: { state: ViewState; item: ViewTask }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Priority of ${item.title}: ${PRIORITY_LABELS[item.priority]}`}
        className={cell}
      >
        {item.priority === "NONE" ? (
          empty
        ) : (
          <>
            <PriorityGlyph priority={item.priority} />
            <span>{PRIORITY_LABELS[item.priority]}</span>
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={item.priority}
          onValueChange={(value) => {
            const priority = value as TaskPriority;
            if (priority === item.priority) return;
            void applyEdit(
              state,
              [
                {
                  item,
                  commands: [{ type: "task.priority", id: item.id, priority, from: item.priority }],
                },
              ],
              `Priority set to ${PRIORITY_LABELS[priority]}.`,
            );
          }}
        >
          {TASK_PRIORITIES.map((priority) => (
            <DropdownMenuRadioItem key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
              <span className="ml-auto">
                <PriorityGlyph priority={priority} />
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function DoneCell({ state, item }: { state: ViewState; item: ViewTodo }) {
  return (
    <div className="px-1">
      <CheckButton
        shape="round"
        checked={item.isComplete}
        label={item.isComplete ? `Reopen ${item.title}` : `Complete ${item.title}`}
        onCheckedChange={(done) =>
          void applyEdit(
            state,
            [{ item, commands: [{ type: "todo.done", id: item.id, done }] }],
            done ? "Marked done." : "Marked not done.",
          )
        }
        className="size-9 md:size-8"
      />
    </div>
  );
}

// ---- Dates --------------------------------------------------------------------------------------

function DueCell({ state, item }: { state: ViewState; item: ViewTask | ViewTodo }) {
  const { prefs, nowMs } = useTaskContext();
  const isTask = state.collection === "TASKS";
  const closed = isTask
    ? ["DONE", "CANCELLED"].includes((item as ViewTask).status)
    : (item as ViewTodo).isComplete;
  const recurring = isTask && Boolean((item as ViewTask).recurrenceRule);

  function pick(dueDate: string | null) {
    if (dueDate === item.dueDate) return;
    const command: MoveCommand = isTask
      ? { type: "task.dueDate", id: item.id, dueDate, from: item.dueDate }
      : { type: "todo.dueDate", id: item.id, dueDate, from: item.dueDate };
    void applyEdit(
      state,
      [{ item, commands: [command] }],
      dueDate ? "Due date changed." : "Due date cleared.",
    );
  }

  return (
    <DatePopover
      id={`due-${item.id}`}
      label="Due date"
      date={item.dueDate}
      onPick={pick}
      clearDisabledReason={recurring ? "A repeating task needs a due date." : undefined}
    >
      <button type="button" aria-label={`Due date of ${item.title}`} className={cell}>
        {item.dueDate ? (
          <DueChip
            dueDate={item.dueDate}
            dueTime={isTask ? (item as ViewTask).dueTime : null}
            status={closed ? "DONE" : "PLANNED"}
            prefs={prefs}
            nowMs={nowMs}
          />
        ) : (
          empty
        )}
      </button>
    </DatePopover>
  );
}

function StartCell({ state, item }: { state: ViewState; item: ViewTask }) {
  const { today } = useTaskContext();
  return (
    <DatePopover
      id={`start-${item.id}`}
      label="Start date"
      date={item.startDate}
      onPick={(startDate) => {
        if (startDate === item.startDate) return;
        void applyEdit(
          state,
          [
            {
              item,
              commands: [{ type: "task.startDate", id: item.id, startDate, from: item.startDate }],
            },
          ],
          startDate ? "Start date changed." : "Start date cleared.",
        );
      }}
    >
      <button type="button" aria-label={`Start date of ${item.title}`} className={cell}>
        {item.startDate ? (
          <span className="type-data-sm">{formatDay(item.startDate, today)}</span>
        ) : (
          empty
        )}
      </button>
    </DatePopover>
  );
}

// ---- Project and tags ---------------------------------------------------------------------------

function ProjectCell({ state, item }: Props) {
  const itemType =
    state.collection === "TASKS" ? "task" : state.collection === "TODOS" ? "todo" : "note";
  return (
    <ProjectPicker
      value={item.project}
      onChange={async (projectId) => {
        if ((item.project?.id ?? null) === projectId) return;
        await applyEdit(
          state,
          [
            {
              item,
              commands: [
                {
                  type: "project",
                  itemType,
                  id: item.id,
                  projectId,
                  from: item.project?.id ?? null,
                },
              ],
            },
          ],
          projectId ? "Project changed." : "Removed from its project.",
        );
      }}
    >
      <button type="button" aria-label={`Project of ${item.title}`} className={cell}>
        {item.project ? <ProjectToken project={item.project} /> : empty}
      </button>
    </ProjectPicker>
  );
}

function TagsCell({ state, item }: { state: ViewState; item: ViewTask | ViewNote }) {
  const itemType = state.collection === "TASKS" ? "task" : "note";
  return (
    <TagPicker
      selected={item.tags}
      onChange={async (tagIds) => {
        const ok = await applyEdit(
          state,
          [
            {
              item,
              commands: [
                { type: "tags", itemType, id: item.id, tagIds, from: item.tags.map((t) => t.id) },
              ],
            },
          ],
          "Tags changed.",
        );
        if (!ok) {
          toast.error("Couldn't update the tags. Try again.");
          return null;
        }
        return tagIds
          .map((id) => state.ctx.tags.find((t) => t.id === id))
          .filter((t): t is NonNullable<typeof t> => Boolean(t));
      }}
    >
      <button type="button" aria-label={`Tags of ${item.title}`} className={cn(cell, "flex-wrap")}>
        {item.tags.length > 0
          ? item.tags
              .slice(0, 3)
              .map((tag) => <TagBadge key={tag.id} tag={tag} className="max-w-24" />)
          : empty}
      </button>
    </TagPicker>
  );
}
