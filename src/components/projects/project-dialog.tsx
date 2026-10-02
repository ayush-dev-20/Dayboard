"use client";

import { useState } from "react";
import { createProject, updateProject } from "@/actions/projects";
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
import { NativeSelect } from "@/components/ui/native-select";
import { DEFAULT_PROJECT_COLOR, type ColorToken } from "@/lib/colors";
import type { ProjectDTO } from "@/lib/projects/dto";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/status";
import { cn } from "@/lib/utils";
import { ColorSwatches } from "./color-swatches";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing; absent when creating. */
  project?: ProjectDTO;
  /** Called with the saved project, after the dialog closes. */
  onSaved?: (project: ProjectDTO) => void;
  /** A name to start with, e.g. what was typed in a picker's search box. */
  initialName?: string;
};

/** A small focused form: name, description, colour, status. Used to create and to edit. */
export function ProjectDialog({ open, onOpenChange, project, onSaved, initialName }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle>
        <DialogDescription className="sr-only">
          {project ? "Change the project's details." : "Name your project and choose a colour."}
        </DialogDescription>
        {/* Mounted only while open, so the fields always start from the saved values. */}
        <ProjectForm
          project={project}
          initialName={initialName}
          close={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      </DialogContent>
    </Dialog>
  );
}

function ProjectForm({
  project,
  initialName,
  close,
  onSaved,
}: {
  project?: ProjectDTO;
  initialName?: string;
  close: () => void;
  onSaved?: (project: ProjectDTO) => void;
}) {
  const [name, setName] = useState(project?.name ?? initialName ?? "");
  const [description, setDescription] = useState(project?.description ?? "");
  const [color, setColor] = useState<ColorToken>(project?.color ?? DEFAULT_PROJECT_COLOR);
  const [status, setStatus] = useState<ProjectStatus>(project?.status ?? "ACTIVE");
  const [nameError, setNameError] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setNameError(undefined);
    setPending(true);
    const values = { name, description, color, status };
    const result = project
      ? await updateProject({ id: project.id, ...values })
      : await createProject(values);
    setPending(false);
    if (!result.ok) {
      if (result.error.fieldErrors?.name) setNameError(result.error.fieldErrors.name);
      else setError(result.error.message);
      return;
    }
    close();
    onSaved?.(result.data);
  }

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
      {error ? <Alert>{error}</Alert> : null}
      <Field id="project-name" label="Name" error={nameError}>
        {(a11y) => (
          <Input
            {...a11y}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={100}
            autoComplete="off"
            autoFocus
          />
        )}
      </Field>
      <Field id="project-description" label="Description">
        {(a11y) => (
          <textarea
            {...a11y}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            className={cn(inputClasses, "h-auto min-h-20 resize-y py-2")}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="type-label-md">Colour</span>
        <ColorSwatches label="Colour" value={color} onChange={setColor} />
      </div>
      <Field id="project-status" label="Status">
        {(a11y) => (
          <NativeSelect
            {...a11y}
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          >
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROJECT_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="secondary">Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : project ? "Save" : "Create project"}
        </Button>
      </DialogFooter>
    </form>
  );
}
