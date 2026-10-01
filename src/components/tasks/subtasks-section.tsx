"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createTask, deleteTask, restoreTask, setTaskStatus, updateTask } from "@/actions/tasks";
import { CheckButton } from "@/components/ui/check-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TaskDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";

type Props = {
  parentId: string;
  items: TaskDTO[];
  onChange: (items: TaskDTO[]) => void;
};

function SubtaskRow({
  task,
  onToggle,
  onRename,
  onDelete,
}: {
  task: TaskDTO;
  onToggle: (done: boolean) => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);
  const done = task.status === "DONE";

  function commit() {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== task.title) onRename(next);
    else setDraft(task.title);
  }

  return (
    <li className="group flex min-h-row-touch items-center gap-2 border-b border-border md:min-h-row">
      <CheckButton
        checked={done}
        onCheckedChange={onToggle}
        label={done ? `Reopen ${task.title}` : `Complete ${task.title}`}
        className="ml-1"
      />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setDraft(task.title);
              setEditing(false);
            }
          }}
          maxLength={500}
          aria-label="Subtask title"
          className="h-9 min-w-0 flex-1 bg-transparent text-[16px] outline-none md:text-[14px]"
        />
      ) : (
        <button
          type="button"
          onClick={() => {
            setDraft(task.title);
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 truncate text-left text-[16px] md:text-[14px]",
            done && "text-muted-foreground line-through",
          )}
        >
          {task.title}
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`More actions for ${task.title}`}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary data-[state=open]:opacity-100 md:size-8 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
        >
          <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            className="text-destructive data-[highlighted]:text-destructive"
            onSelect={onDelete}
          >
            <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/** One level of subtasks, each a small task of its own. Changes show at once and revert if saving fails. */
export function SubtasksSection({ parentId, items, onChange }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const result = await createTask({ title, parentTaskId: parentId });
    if (!result.ok) {
      setDraft(title);
      toast.error(result.error.fieldErrors?.title ?? "Couldn't add that subtask. Try again.");
      return;
    }
    onChange([...items, result.data]);
    router.refresh();
    input.current?.focus();
  }

  async function toggle(task: TaskDTO, done: boolean) {
    const before = items;
    const status = done ? "DONE" : "PLANNED";
    onChange(items.map((t) => (t.id === task.id ? { ...t, status } : t)));
    const result = await setTaskStatus({ id: task.id, status });
    if (!result.ok) {
      onChange(before);
      toast.error("Couldn't update that subtask.", {
        action: { label: "Retry", onClick: () => void toggle(task, done) },
      });
      return;
    }
    router.refresh();
  }

  async function rename(task: TaskDTO, title: string) {
    const before = items;
    onChange(items.map((t) => (t.id === task.id ? { ...t, title } : t)));
    const result = await updateTask({ id: task.id, title });
    if (!result.ok) {
      onChange(before);
      toast.error("Couldn't rename that subtask.");
    }
  }

  async function remove(task: TaskDTO) {
    const before = items;
    const result = await deleteTask({ id: task.id });
    if (!result.ok) {
      toast.error("Couldn't move that to Trash. Try again.");
      return;
    }
    onChange(before.filter((t) => t.id !== task.id));
    router.refresh();
    toast("Subtask moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const restored = await restoreTask({ id: task.id });
          if (!restored.ok) {
            toast.error("Couldn't restore that. Try Trash.");
            return;
          }
          onChange(
            [...before.filter((t) => t.id !== task.id), restored.data].sort(
              (a, b) => a.sortOrder - b.sortOrder,
            ),
          );
          router.refresh();
        },
      },
    });
  }

  return (
    <section aria-labelledby="subtasks-heading" className="mt-6">
      <h3 id="subtasks-heading" className="mb-2 type-label-caps text-muted-foreground">
        Subtasks
      </h3>
      {items.length > 0 ? (
        <ul className="border-t border-border">
          {items.map((task) => (
            <SubtaskRow
              key={task.id}
              task={task}
              onToggle={(done) => void toggle(task, done)}
              onRename={(title) => void rename(task, title)}
              onDelete={() => void remove(task)}
            />
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={add}
        className="flex items-center gap-2 border-b border-border focus-within:border-primary"
      >
        <Plus
          className="ml-3 size-4 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden
        />
        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Add subtask"
          aria-label="Add subtask"
          autoComplete="off"
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-muted-foreground md:h-9 md:text-[14px]"
        />
      </form>
    </section>
  );
}
