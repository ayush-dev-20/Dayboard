"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NoteCrumbDTO } from "@/lib/notes/dto";
import { breadcrumbParts } from "@/lib/notes/tree";

// `Notes / Parent / Child` above a note (V2 feature 07 §5). Each part is a link; the last is the
// note itself. A long chain keeps the top-level note and the nearest parents and folds the middle
// into "…", which opens a menu of what it hides. A top-level note keeps its project crumb.

const sep = <span aria-hidden> / </span>;
const crumbLink = "hover:text-foreground";
const label = (c: NoteCrumbDTO) => c.title.trim() || "Untitled";

export function NoteBreadcrumb({
  ancestors,
  project,
  title,
  isNew,
}: {
  ancestors: NoteCrumbDTO[];
  project: { id: string; name: string } | null;
  /** The note's own title as it is now (it changes while typing). */
  title: string;
  isNew: boolean;
}) {
  const nested = ancestors.length > 0;
  return (
    <nav
      aria-label="Breadcrumb"
      className="min-w-0 flex-1 truncate type-body-md text-muted-foreground max-md:hidden"
    >
      <Link href="/notes" className={crumbLink}>
        Notes
      </Link>
      {nested ? (
        <>
          {breadcrumbParts(ancestors).map((part) =>
            part.kind === "note" ? (
              <span key={part.crumb.id}>
                {sep}
                <Link href={`/notes/${part.crumb.id}`} className={crumbLink}>
                  {part.crumb.emoji ? `${part.crumb.emoji} ` : ""}
                  {label(part.crumb)}
                </Link>
              </span>
            ) : (
              <span key="more">
                {sep}
                <DropdownMenu>
                  <DropdownMenuTrigger
                    aria-label={`${part.hidden.length} more notes in the path`}
                    className="inline-flex h-5 cursor-pointer items-center rounded-sm px-1 align-middle hover:bg-accent hover:text-foreground"
                  >
                    <Ellipsis className="size-3.5" strokeWidth={1.5} aria-hidden />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {part.hidden.map((crumb) => (
                      <DropdownMenuItem key={crumb.id} asChild>
                        <Link href={`/notes/${crumb.id}`}>
                          {crumb.emoji ? `${crumb.emoji} ` : ""}
                          {label(crumb)}
                        </Link>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            ),
          )}
          {sep}
          <span aria-current="page" className="text-foreground">
            {title.trim() || "Untitled"}
          </span>
        </>
      ) : (
        <>
          {project ? (
            <>
              {sep}
              <Link href={`/projects/${project.id}`} className={crumbLink}>
                {project.name}
              </Link>
            </>
          ) : null}
          {isNew ? " / New note" : null}
        </>
      )}
    </nav>
  );
}
