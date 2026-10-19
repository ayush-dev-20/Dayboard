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
import { TintChip } from "@/components/workspace/tokens";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { DUE_FILTER_LABELS, DUE_FILTERS, type DueFilter } from "@/lib/tasks/grouping";
import { buildTasksQuery, describeStatuses, type TasksParams } from "@/lib/tasks/params";
import {
  OPEN_STATUSES,
  STATUS_COLORS,
  STATUS_LABELS,
  TASK_STATUSES,
  type TaskStatus,
} from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

// A soft fill, like Notion's filter chips (ADR 0027). A filter that is doing something fills with the selection
// tint, so what narrows the list reads at a glance; the words say the same.
const triggerClasses = (active: boolean) =>
  cn(
    "type-body-md inline-flex h-11 items-center gap-1.5 rounded-md px-3 transition-colors duration-[120ms] md:h-8",
    active
      ? "bg-primary-subtle text-foreground hover:bg-primary-subtle/70"
      : "bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
  );

/** Filters live in the URL, so a filtered list can be refreshed, linked and sent back with the Back button. */
export function TaskFilters({
  params,
  trailing,
  sortLabel = "Sorted by your order",
}: {
  params: TasksParams;
  /** What goes at the end of the row (the view's settings button). */
  trailing?: React.ReactNode;
  /** The line shown before it, describing the view's sort. */
  sortLabel?: string;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const { projects, tags } = useWorkspace();
  const project = projects.find((p) => p.id === params.projectId);
  const tag = tags.find((t) => t.id === params.tagId);
  // Whether each filter differs from what the list shows by default.
  const statusActive =
    params.archived ||
    params.statuses.length !== OPEN_STATUSES.length ||
    !OPEN_STATUSES.every((s) => params.statuses.includes(s));

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
        <DropdownMenuTrigger className={triggerClasses(statusActive)}>
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
              <TintChip color={STATUS_COLORS[status]}>{STATUS_LABELS[status]}</TintChip>
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
        <DropdownMenuTrigger className={triggerClasses(params.due !== "any")}>
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
        <DropdownMenuTrigger className={triggerClasses(Boolean(params.projectId))}>
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
                <TintChip color={p.color}>{p.name}</TintChip>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger className={triggerClasses(Boolean(params.tagId))}>
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
                {t.color ? <TintChip color={t.color}>{t.name}</TintChip> : t.name}
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

      <span className="ml-auto hidden type-body-sm text-muted-foreground sm:inline">
        {sortLabel}
      </span>
      {trailing ? (
        <span className={trailing ? "ml-2 max-sm:ml-auto" : undefined}>{trailing}</span>
      ) : null}
    </div>
  );
}
