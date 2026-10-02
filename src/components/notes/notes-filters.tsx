"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ColorDot } from "@/components/workspace/tokens";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { buildNotesQuery, hasNoteFilters, type NotesParams } from "@/lib/notes/params";

const triggerClasses =
  "type-body-md inline-flex h-11 items-center gap-1.5 rounded-md px-3 text-muted-foreground hover:bg-accent hover:text-foreground md:h-8";

/** Project and tag filters, kept in the URL so a filtered list can be refreshed and shared. */
export function NotesFilters({ params }: { params: NotesParams }) {
  const router = useRouter();
  const { projects, tags } = useWorkspace();
  const project = projects.find((p) => p.id === params.projectId);
  const tag = tags.find((t) => t.id === params.tagId);

  function go(patch: Partial<NotesParams>) {
    router.replace(`/notes${buildNotesQuery({ ...params, ...patch })}`, { scroll: false });
  }

  return (
    <div className="flex flex-wrap items-center gap-1 py-2">
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

      {hasNoteFilters(params) ? (
        <Link href="/notes" className="px-2 type-body-md text-primary underline underline-offset-2">
          Clear filters
        </Link>
      ) : null}

      <span className="ml-auto type-body-sm text-muted-foreground">Last updated first</span>
    </div>
  );
}
