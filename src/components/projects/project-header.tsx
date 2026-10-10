"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Ellipsis, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteProject, restoreProject, updateProject } from "@/actions/projects";
import { AskAboutMenuItem } from "@/components/assistant/ask-about";
import { ConfirmDialog } from "@/components/layout/confirm-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "@/components/workspace/tokens";
import type { ProjectDTO } from "@/lib/projects/dto";
import type { Progress } from "@/lib/projects/progress";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/status";
import { ProgressBar } from "./progress-bar";
import { ProjectDialog } from "./project-dialog";

type Props = { project: ProjectDTO; progress: Progress };

/**
 * Name, status, description and progress of one project. Name and description are edited in
 * place and saved when you click away; colour is in "Edit details". Moving to Trash asks first and
 * says what happens to the items.
 */
export function ProjectHeader({ project, progress }: Props) {
  const router = useRouter();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  async function commitName() {
    const next = name.trim();
    if (next === project.name) return setName(project.name);
    if (!next) {
      setName(project.name);
      toast.error("Enter a project name.");
      return;
    }
    const result = await updateProject({ id: project.id, name: next });
    if (!result.ok) {
      setName(project.name);
      toast.error(result.error.fieldErrors?.name ?? result.error.message);
    }
  }

  async function commitDescription() {
    if (description.trim() === (project.description ?? "")) return;
    const result = await updateProject({ id: project.id, description });
    if (!result.ok) {
      setDescription(project.description ?? "");
      toast.error(result.error.fieldErrors?.description ?? result.error.message);
    }
  }

  async function changeStatus(status: ProjectStatus) {
    if (status === project.status) return;
    const result = await updateProject({ id: project.id, status });
    if (!result.ok) toast.error(result.error.message);
  }

  async function trash() {
    setPending(true);
    const result = await deleteProject({ id: project.id });
    setPending(false);
    if (!result.ok) {
      toast.error("Couldn't move that to Trash. Try again.");
      return;
    }
    setConfirming(false);
    router.push("/projects");
    toast("Project moved to Trash.", {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: async () => {
          const undo = await restoreProject({ id: project.id });
          if (!undo.ok) toast.error("Couldn't restore that. Try Trash.");
          else router.refresh();
        },
      },
    });
  }

  return (
    <header className="mb-6">
      <div className="flex items-center gap-3">
        <ColorDot color={project.color} className="size-2.5" />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitName()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              setName(project.name);
              e.currentTarget.blur();
            }
          }}
          maxLength={100}
          aria-label="Project name"
          className="min-w-0 flex-1 bg-transparent type-headline-md text-foreground outline-none md:type-headline-lg"
        />

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={`Status: ${PROJECT_STATUS_LABELS[project.status]}`}
            className="inline-flex h-11 shrink-0 items-center gap-1 rounded-md px-2 type-label-md text-foreground hover:bg-accent md:h-8"
          >
            {PROJECT_STATUS_LABELS[project.status]}
            <ChevronDown className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={project.status}
              onValueChange={(v) => void changeStatus(v as ProjectStatus)}
            >
              {PROJECT_STATUSES.map((status) => (
                <DropdownMenuRadioItem key={status} value={status}>
                  {PROJECT_STATUS_LABELS[status]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="More actions"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8"
          >
            <Ellipsis className="size-4" strokeWidth={1.5} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <AskAboutMenuItem type="project" id={project.id} />
            <DropdownMenuItem onSelect={() => setEditing(true)}>
              <Pencil strokeWidth={1.5} aria-hidden /> Edit details
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive data-[highlighted]:text-destructive"
              onSelect={() => setConfirming(true)}
            >
              <Trash2 strokeWidth={1.5} aria-hidden /> Move to Trash
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <textarea
        rows={1}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => void commitDescription()}
        placeholder="Add a description"
        aria-label="Project description"
        maxLength={2000}
        className="mt-2 field-sizing-content w-full resize-none bg-transparent type-body-md text-muted-foreground outline-none placeholder:text-muted-foreground"
      />

      <div className="mt-3 flex max-w-md items-center gap-3">
        {progress.percent === null ? (
          <p className="type-body-sm text-muted-foreground">No items yet</p>
        ) : (
          <>
            <ProgressBar percent={progress.percent} className="flex-1" />
            <p className="shrink-0 type-body-sm text-muted-foreground">
              {progress.done} of {progress.counted} items done
            </p>
          </>
        )}
      </div>

      <ProjectDialog open={editing} onOpenChange={setEditing} project={project} />
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Move ${project.name} to Trash?`}
        description="The tasks and notes in it are kept. They show as “No project” until you restore the project."
        confirmLabel="Move to Trash"
        destructive
        pending={pending}
        onConfirm={trash}
      />
    </header>
  );
}
