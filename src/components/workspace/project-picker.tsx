"use client";

import { useState } from "react";
import { Check, Plus, Search, X } from "lucide-react";
import { ProjectDialog } from "@/components/projects/project-dialog";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ProjectRef } from "@/lib/projects/dto";
import { PROJECT_STATUS_LABELS, type ProjectStatus } from "@/lib/projects/status";
import { cn } from "@/lib/utils";
import { handlePickerKeys } from "./picker-list";
import { ColorDot } from "./tokens";
import { useWorkspace } from "./workspace-context";

type Props = {
  value: ProjectRef | null;
  /** Called with the chosen project's id, or null for "No project". */
  onChange: (projectId: string | null) => void | Promise<void>;
  /** The trigger button. */
  children: React.ReactNode;
  align?: "start" | "end";
  /** Controlled mode: open it from elsewhere (a menu item). The children then only mark where it appears. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Off inside a dialog, where a second dialog would be nested. */
  allowCreate?: boolean;
};

const itemClasses =
  "flex h-11 w-full items-center gap-2 rounded-md px-2 text-left type-body-md hover:bg-accent focus-visible:bg-accent md:h-8";

/**
 * One project picker for every screen: search, projects grouped by status (active first), "No
 * project", and "New project". Choosing is optional everywhere; "No project" is always available.
 */
export function ProjectPicker({
  value,
  onChange,
  children,
  align = "start",
  allowCreate = true,
  open: controlledOpen,
  onOpenChange,
}: Props) {
  const { projects } = useWorkspace();
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : innerOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setInnerOpen(next);
    onOpenChange?.(next);
  };
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = projects.filter((p) => p.name.toLowerCase().includes(needle));
  const groups = (["ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"] as ProjectStatus[])
    .map((status) => ({ status, items: visible.filter((p) => p.status === status) }))
    .filter((g) => g.items.length > 0);

  function choose(projectId: string | null) {
    setOpen(false);
    void onChange(projectId);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) setQuery("");
        }}
      >
        {controlled ? (
          <PopoverAnchor asChild>{children}</PopoverAnchor>
        ) : (
          <PopoverTrigger asChild>{children}</PopoverTrigger>
        )}
        <PopoverContent align={align} className="w-64 p-1" onKeyDown={handlePickerKeys}>
          <label className="relative block p-1">
            <span className="sr-only">Search projects</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              strokeWidth={1.5}
              aria-hidden
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects"
              autoComplete="off"
              className="h-11 w-full rounded-md border border-input bg-background pr-3 pl-9 text-[16px] outline-none placeholder:text-muted-foreground focus-visible:border-primary md:h-9 md:text-[14px]"
            />
          </label>

          <div className="max-h-64 overflow-y-auto">
            {groups.map((group) => (
              <div key={group.status} role="group" aria-label={PROJECT_STATUS_LABELS[group.status]}>
                <p className="px-2 pt-2 pb-1 type-label-caps text-muted-foreground">
                  {PROJECT_STATUS_LABELS[group.status]}
                </p>
                {group.items.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    data-picker-item
                    onClick={() => choose(project.id)}
                    className={itemClasses}
                  >
                    <ColorDot color={project.color} />
                    <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    {value?.id === project.id ? (
                      <>
                        <Check className="size-4 text-primary" strokeWidth={1.5} aria-hidden />
                        <span className="sr-only">(current)</span>
                      </>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
            {visible.length === 0 ? (
              <p className="px-2 py-3 type-body-sm text-muted-foreground">
                {projects.length === 0 ? "No projects yet." : "No projects match."}
              </p>
            ) : null}
          </div>

          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              data-picker-item
              onClick={() => choose(null)}
              className={itemClasses}
            >
              <X className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
              <span className="flex-1">No project</span>
              {value === null ? <span className="sr-only">(current)</span> : null}
            </button>
            {allowCreate ? (
              <button
                type="button"
                data-picker-item
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
                className={cn(itemClasses)}
              >
                <Plus className="size-4 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                <span className="flex-1">New project</span>
              </button>
            ) : null}
          </div>
        </PopoverContent>
      </Popover>

      <ProjectDialog
        open={creating}
        onOpenChange={setCreating}
        initialName={query.trim()}
        onSaved={(project) => void onChange(project.id)}
      />
    </>
  );
}
