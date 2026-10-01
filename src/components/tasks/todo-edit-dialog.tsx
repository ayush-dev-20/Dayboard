"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateTodo } from "@/actions/todos";
import { EmojiButton } from "@/components/emoji/emoji-picker";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { TodoDTO } from "@/lib/tasks/dto";

type Props = { todo: TodoDTO; open: boolean; onOpenChange: (open: boolean) => void };

/** A small focused form: emoji, title and an optional due date. Todos have nothing else. */
export function TodoEditDialog({ todo, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Edit todo</DialogTitle>
        <DialogDescription className="sr-only">
          Change the title, emoji or due date.
        </DialogDescription>
        {/* Mounted only while open, so the fields always start from the saved values. */}
        <EditForm todo={todo} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ todo, close }: { todo: TodoDTO; close: () => void }) {
  const [title, setTitle] = useState(todo.title);
  const [emoji, setEmoji] = useState<string | null>(todo.emoji);
  const [dueDate, setDueDate] = useState(todo.dueDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setTitleError(undefined);
    setPending(true);
    const result = await updateTodo({ id: todo.id, title, emoji, dueDate: dueDate || null });
    setPending(false);
    if (!result.ok) {
      if (result.error.fieldErrors?.title) setTitleError(result.error.fieldErrors.title);
      else setError(result.error.message);
      return;
    }
    toast("Saved");
    close();
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex items-start gap-2">
        <EmojiButton value={emoji} label="Todo emoji" onChange={setEmoji} className="mt-6" />
        <Field id="todo-title" label="Title" error={titleError} className="flex-1">
          {(a11y) => (
            <Input
              {...a11y}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              autoComplete="off"
            />
          )}
        </Field>
      </div>
      <Field id="todo-due" label="Due date (optional)">
        {(a11y) => (
          <Input
            {...a11y}
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
          />
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
