"use client";

import { Button } from "@/components/ui/button";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "@/components/workspace/tokens";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { DUE_FILTER_LABELS, DUE_FILTERS, type DueFilter } from "@/lib/tasks/grouping";
import { buildTasksQuery, describeStatuses, type TasksParams } from "@/lib/tasks/params";
import { OPEN_STATUSES, STATUS_LABELS, TASK_STATUSES, type TaskStatus } from "@/lib/tasks/status";

const triggerClasses =
  "type-body-md inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-muted-foreground hover:bg-accent hover:text-foreground md:h-8";

/** Filters live in the URL, so a filtered list can be refreshed, linked and sent back with the Back button. */
export function TaskFilters({ params }: { params: TasksParams }) {
  const router = useRouter();
  const search = useSearchParams();
  const { projects, tags } = useWorkspace();
  const project = projects.find((p) => p.id === params.projectId);
  const tag = tags.find((t) => t.id === params.tagId);

  function go(patch: Partial<TasksParams>) {
    const next = { ...params, ...patch };
    // Keep the open task when filtering so the sheet doesn't close under the person.
    const query = buildTasksQuery({
      ...next,
      view: "tasks",
      taskId: search.get("task") ?? undefined,
    });
    router.replace(`/tasks${query}`, { scroll: false });
  }

  function toggleStatus(status: TaskStatus, checked: boolean) {
    const set = new Set(params.statuses);
    if (checked) set.add(status);
    else set.delete(status);
    go({ statuses: set.size === 0 ? [...OPEN_STATUSES] : TASK_STATUSES.filter((s) => set.has(s)) });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 py-2">
      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClasses}>
          Status{" "}
          <b className="font-semibold text-foreground">{describeStatuses(params.statuses)}</b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {TASK_STATUSES.map((status) => (
            <DropdownMenuCheckboxItem
              key={status}
              checked={params.statuses.includes(status)}
              onCheckedChange={(checked) => toggleStatus(status, checked)}
              onSelect={(event) => event.preventDefault()}
            >
              {STATUS_LABELS[status]}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            checked={params.archived}
            onCheckedChange={(checked) => go({ archived: checked })}
            onSelect={(event) => event.preventDefault()}
          >
            Show archived
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <Button
            variant="secondary"
            onClick={() => go({ statuses: [...OPEN_STATUSES], archived: false })}
            className="mx-2 my-1 w-[calc(100%-1rem)]"
          >
            Clear status filter
          </Button>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClasses}>
          Due <b className="font-semibold text-foreground">{DUE_FILTER_LABELS[params.due]}</b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-44">
          <DropdownMenuRadioGroup
            value={params.due}
            onValueChange={(value) => go({ due: value as DueFilter })}
          >
            {DUE_FILTERS.map((due) => (
              <DropdownMenuRadioItem key={due} value={due}>
                {DUE_FILTER_LABELS[due]}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClasses}>
          Project{" "}
          <b className="font-semibold text-foreground">
            {params.projectId === "none" ? "No project" : (project?.name ?? "Any")}
          </b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-52 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={params.projectId ?? "any"}
            onValueChange={(value) => go({ projectId: value === "any" ? null : value })}
          >
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="none">No project</DropdownMenuRadioItem>
            {projects.map((p) => (
              <DropdownMenuRadioItem key={p.id} value={p.id}>
                <ColorDot color={p.color} /> {p.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClasses}>
          Tag <b className="font-semibold text-foreground">{tag?.name ?? "Any"}</b>
          <ChevronDown className="size-4" strokeWidth={1.5} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 min-w-44 overflow-y-auto">
          <DropdownMenuRadioGroup
            value={params.tagId ?? "any"}
            onValueChange={(value) => go({ tagId: value === "any" ? null : value })}
          >
            <DropdownMenuRadioItem value="any">Any</DropdownMenuRadioItem>
            {tags.map((t) => (
              <DropdownMenuRadioItem key={t.id} value={t.id}>
                {t.color ? <ColorDot color={t.color} /> : null} {t.name}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {params.projectId || params.tagId ? (
        <Button variant="secondary" onClick={() => go({ projectId: null, tagId: null })}>
          Clear filters
        </Button>
      ) : null}

      <span className="ml-auto type-body-sm text-muted-foreground">Sorted by your order</span>
    </div>
  );
}
