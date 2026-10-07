"use client";

import { useState } from "react";
import { Archive, CircleCheck, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ProjectPicker } from "@/components/workspace/project-picker";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/tasks/status";
import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import type { MoveCommand } from "@/lib/views/move-card";
import { applyEdit } from "./apply";
import { DatePopover } from "./date-popover";
import type { ViewState } from "./view-state";

const noun = (collection: ViewState["collection"], n: number) =>
  collection === "TASKS"
    ? n === 1
      ? "task"
      : "tasks"
    : collection === "TODOS"
      ? n === 1
        ? "todo"
        : "todos"
      : n === 1
        ? "note"
        : "notes";

/**
 * What can be done to several selected rows at once (V2 feature 06 §5). Each is the same command a
 * single edit runs, once per row, shown at once and taken back by one Undo.
 */
export function BulkBar({
  state,
  selected,
  onClear,
}: {
  state: ViewState;
  selected: AnyItem[];
  onClear: () => void;
}) {
  const { tags } = useWorkspace();
  const { collection } = state;
  const [trashing, setTrashing] = useState(false);
  const itemType = collection === "TASKS" ? "task" : collection === "TODOS" ? "todo" : "note";
  const count = selected.length;
  const what = `${count} ${noun(collection, count)}`;

  async function run(
    commandsFor: (item: AnyItem) => MoveCommand[],
    message: string,
  ): Promise<void> {
    const changes = selected
      .map((item) => ({ item, commands: commandsFor(item) }))
      .filter((c) => c.commands.length > 0);
    if (changes.length === 0) {
      toast("Nothing to change.");
      return;
    }
    if (await applyEdit(state, changes, message)) onClear();
  }

  function setTags(add: boolean, tagId: string, tagName: string) {
    void run(
      (item) => {
        const current = (item as ViewTask | ViewNote).tags.map((t) => t.id);
        const next = add ? [...new Set([...current, tagId])] : current.filter((id) => id !== tagId);
        if (next.length === current.length && next.every((id) => current.includes(id))) return [];
        return [
          {
            type: "tags",
            itemType: itemType as "task" | "note",
            id: item.id,
            tagIds: next,
            from: current,
          },
        ];
      },
      add ? `Tagged ${what} “${tagName}”.` : `Removed “${tagName}” from ${what}.`,
    );
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-popover p-2 shadow-float float-surface"
    >
      <span className="px-2 type-body-md font-semibold">{count} selected</span>

      {collection === "TASKS" ? (
        <>
          <Menu label="Status">
            {TASK_STATUSES.map((status) => (
              <DropdownMenuItem
                key={status}
                onSelect={() =>
                  void run(
                    (item) =>
                      (item as ViewTask).status === status
                        ? []
                        : [
                            {
                              type: "task.status",
                              id: item.id,
                              status,
                              from: (item as ViewTask).status,
                            },
                          ],
                    `Moved ${what} to ${STATUS_LABELS[status]}.`,
                  )
                }
              >
                {STATUS_LABELS[status]}
              </DropdownMenuItem>
            ))}
          </Menu>
          <Menu label="Priority">
            {TASK_PRIORITIES.map((priority) => (
              <DropdownMenuItem
                key={priority}
                onSelect={() =>
                  void run(
                    (item) =>
                      (item as ViewTask).priority === priority
                        ? []
                        : [
                            {
                              type: "task.priority",
                              id: item.id,
                              priority,
                              from: (item as ViewTask).priority,
                            },
                          ],
                    `Priority set to ${PRIORITY_LABELS[priority]} on ${what}.`,
                  )
                }
              >
                {PRIORITY_LABELS[priority]}
              </DropdownMenuItem>
            ))}
          </Menu>
        </>
      ) : null}

      {collection !== "NOTES" ? (
        <DatePopover
          id="bulk-due"
          label="Due date"
          date={null}
          clearable={false}
          onPick={(dueDate) =>
            void run((item) => {
              const dated = item as ViewTask | ViewTodo;
              if (dated.dueDate === dueDate) return [];
              return [
                collection === "TASKS"
                  ? { type: "task.dueDate", id: item.id, dueDate, from: dated.dueDate }
                  : { type: "todo.dueDate", id: item.id, dueDate, from: dated.dueDate },
              ];
            }, `Due date set on ${what}.`)
          }
        >
          <Button variant="secondary">Due date</Button>
        </DatePopover>
      ) : null}

      <ProjectPicker
        value={null}
        onChange={(projectId) =>
          run(
            (item) =>
              (item.project?.id ?? null) === projectId
                ? []
                : [
                    {
                      type: "project",
                      itemType,
                      id: item.id,
                      projectId,
                      from: item.project?.id ?? null,
                    },
                  ],
            projectId ? `Moved ${what} to a project.` : `Removed ${what} from their projects.`,
          )
        }
      >
        <Button variant="secondary">Project</Button>
      </ProjectPicker>

      {collection !== "TODOS" ? (
        <>
          <Menu label="Add tag" empty={tags.length === 0 ? "No tags yet" : undefined}>
            {tags.map((tag) => (
              <DropdownMenuItem key={tag.id} onSelect={() => setTags(true, tag.id, tag.name)}>
                {tag.name}
              </DropdownMenuItem>
            ))}
          </Menu>
          <Menu label="Remove tag" empty={tags.length === 0 ? "No tags yet" : undefined}>
            {tags.map((tag) => (
              <DropdownMenuItem key={tag.id} onSelect={() => setTags(false, tag.id, tag.name)}>
                {tag.name}
              </DropdownMenuItem>
            ))}
          </Menu>
        </>
      ) : null}

      {collection !== "NOTES" ? (
        <Button
          variant="secondary"
          onClick={() =>
            void run(
              (item) =>
                collection === "TASKS"
                  ? (item as ViewTask).status === "DONE"
                    ? []
                    : [
                        {
                          type: "task.status",
                          id: item.id,
                          status: "DONE",
                          from: (item as ViewTask).status,
                        },
                      ]
                  : (item as ViewTodo).isComplete
                    ? []
                    : [{ type: "todo.done", id: item.id, done: true }],
              `Completed ${what}.`,
            )
          }
        >
          <CircleCheck strokeWidth={1.5} aria-hidden /> Complete
        </Button>
      ) : null}

      <Button
        variant="secondary"
        onClick={() =>
          void run(
            (item) => [{ type: "archive", itemType, id: item.id, archived: true }],
            `Archived ${what}.`,
          )
        }
      >
        <Archive strokeWidth={1.5} aria-hidden /> Archive
      </Button>

      <Button variant="secondary" onClick={() => setTrashing(true)}>
        <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
      </Button>

      <Button variant="ghost" onClick={onClear} className="ml-auto">
        <X strokeWidth={1.5} aria-hidden /> Clear selection
      </Button>

      <ConfirmDialog
        open={trashing}
        onOpenChange={setTrashing}
        title={`Move ${what} to Trash?`}
        description="They can be restored from Trash, and you can undo this right after."
        confirmLabel="Move to Trash"
        destructive
        onConfirm={async () => {
          setTrashing(false);
          await run(
            (item) => [{ type: "trash", itemType, id: item.id }],
            `Moved ${what} to Trash.`,
          );
        }}
      />
    </div>
  );
}

function Menu({
  label,
  empty,
  children,
}: {
  label: string;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">{label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {empty ? <DropdownMenuItem disabled>{empty}</DropdownMenuItem> : children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
