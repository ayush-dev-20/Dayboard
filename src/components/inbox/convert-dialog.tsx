"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { convertInboxItem } from "@/actions/inbox";
import { ProjectPickerControl } from "@/components/tasks/task-properties";
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
import { Input, inputClasses } from "@/components/ui/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { deriveFields, type ConvertTarget } from "@/lib/inbox/convert";
import { describeConversion } from "@/lib/inbox/dto";
import type { ProjectRef } from "@/lib/projects/dto";
import { trashHref } from "@/lib/trash";
import { cn } from "@/lib/utils";

export const TARGETS: { id: ConvertTarget; label: string; submit: string }[] = [
  { id: "task", label: "Task", submit: "Create task" },
  { id: "todo", label: "Todo", submit: "Create todo" },
  { id: "note", label: "Note", submit: "Create note" },
  { id: "task_note", label: "Task + note", submit: "Create task and note" },
  { id: "project", label: "Project idea", submit: "Create project idea" },
];

type Props = {
  item: { id: string; text: string };
  initialTarget: ConvertTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Convert an inbox item. Fields are pre-filled from its text and always editable; nothing is created until the person confirms. */
export function ConvertDialog({ item, initialTarget, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>Convert inbox item</DialogTitle>
        <DialogDescription className="sr-only">
          Choose what this item becomes and check the details before creating it.
        </DialogDescription>
        {/* Mounted only while open, so the fields start from the item's text every time. */}
        <ConvertForm item={item} initialTarget={initialTarget} close={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function ConvertForm({
  item,
  initialTarget,
  close,
}: {
  item: { id: string; text: string };
  initialTarget: ConvertTarget;
  close: () => void;
}) {
  const router = useRouter();
  const { projects } = useWorkspace();
  const [target, setTarget] = useState<ConvertTarget>(initialTarget);
  const [fields, setFields] = useState(() => deriveFields(item.text, initialTarget));
  const [project, setProject] = useState<ProjectRef | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [decideLater, setDecideLater] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [pending, setPending] = useState(false);

  const chosen = TARGETS.find((t) => t.id === target)!;
  const hasProject = target !== "project";
  const hasDate = target === "task" || target === "todo" || target === "task_note";
  const bodyLabel = target === "note" || target === "task_note" ? "Note text" : "Description";
  const hasBody =
    target === "task" || target === "project" || target === "note" || target === "task_note";

  function pick(next: ConvertTarget) {
    setTarget(next);
    setFields(deriveFields(item.text, next));
    setTitleError(undefined);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setTitleError(undefined);
    setPending(true);

    const base = { id: item.id, target };
    const common = { projectId: project?.id ?? null, dueDate: dueDate || null };
    const input =
      target === "task"
        ? { ...base, title: fields.title, description: fields.description, ...common, decideLater }
        : target === "todo"
          ? { ...base, title: fields.title, ...common }
          : target === "note"
            ? {
                ...base,
                title: fields.title,
                body: fields.description,
                projectId: common.projectId,
              }
            : target === "task_note"
              ? { ...base, title: fields.title, body: fields.description, ...common }
              : { ...base, name: fields.title, description: fields.description };

    const result = await convertInboxItem(input);
    setPending(false);
    if (!result.ok) {
      const message = result.error.fieldErrors?.title ?? result.error.fieldErrors?.name;
      if (message) setTitleError(message);
      else setError(result.error.message);
      return;
    }

    const links = result.data.refs;
    const first = links[0]!;
    close();
    toast(`Converted to ${describeConversion(links)}.`, {
      action: { label: "Open", onClick: () => router.push(trashHref(first.type, first.id)) },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}

      <div>
        <p className="mb-1 type-label-md">Convert to</p>
        <div
          role="tablist"
          aria-label="Convert to"
          className="flex flex-wrap gap-x-4 border-b border-border"
        >
          {TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={target === t.id}
              onClick={() => pick(t.id)}
              className={cn(
                "-mb-px h-11 border-b-2 type-body-md md:h-9",
                target === t.id
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Field id="convert-title" label={target === "project" ? "Name" : "Title"} error={titleError}>
        {(a11y) => (
          <Input
            {...a11y}
            value={fields.title}
            onChange={(e) => setFields((f) => ({ ...f, title: e.target.value }))}
            autoComplete="off"
          />
        )}
      </Field>

      {hasBody ? (
        <Field id="convert-body" label={bodyLabel}>
          {(a11y) => (
            <textarea
              {...a11y}
              rows={4}
              value={fields.description}
              onChange={(e) => setFields((f) => ({ ...f, description: e.target.value }))}
              className={cn(inputClasses, "h-auto min-h-24 resize-y py-2")}
            />
          )}
        </Field>
      ) : null}

      {hasProject || hasDate ? (
        <div className="-ml-1.5 flex flex-wrap items-center gap-x-2">
          {hasProject ? (
            <ProjectPickerControl
              value={project}
              allowCreate={false}
              onChange={(id) => setProject(id ? (projects.find((p) => p.id === id) ?? null) : null)}
            />
          ) : null}
          {hasDate ? (
            <label className="inline-flex h-11 items-center gap-2 px-1.5 type-body-md text-muted-foreground md:h-8">
              Due
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Due date"
                className="h-9 rounded-md border border-input bg-background px-2 text-[16px] text-foreground md:h-7 md:text-[13px]"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {target === "task" ? (
        <label className="flex items-center gap-2 type-body-md">
          <input
            type="checkbox"
            checked={decideLater}
            onChange={(e) => setDecideLater(e.target.checked)}
            className="size-4 accent-primary"
          />
          Decide later (keep as Inbox task)
        </label>
      ) : null}

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : chosen.submit}
        </Button>
      </DialogFooter>
    </form>
  );
}

export function ConvertedLinks({
  links,
}: {
  links: { type: string; id: string; title: string; href: string }[];
}) {
  return (
    <>
      {links.map((l) => (
        <Link
          key={`${l.type}:${l.id}`}
          href={l.href}
          className="text-primary underline underline-offset-2"
        >
          {l.title}
        </Link>
      ))}
    </>
  );
}
