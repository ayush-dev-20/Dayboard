import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { colorVar } from "@/lib/colors";
import { formatDay } from "@/lib/dates/calendar";
import type { NextDueTask } from "@/db/queries/projects";
import type { ProjectSummaryDTO } from "@/lib/projects/dto";
import { projectProgress } from "@/lib/projects/progress";
import { cn } from "@/lib/utils";
import { ProgressBar } from "./progress-bar";

/**
 * One project as a card (DESIGN.md: project-card): a 4px strip in its color, the name, up to two
 * lines of description, progress, counts and the next due task. The whole card is the link. The
 * color is decoration; the name is always there.
 */
export function ProjectCard({
  project,
  nextDue,
  today,
}: {
  project: ProjectSummaryDTO;
  nextDue?: NextDueTask;
  /** The person's "YYYY-MM-DD", for the next due date's label. */
  today: string;
}) {
  const progress = projectProgress({
    done: project.doneCount,
    cancelled: project.cancelledCount,
    total: project.totalCount,
  });
  const late = nextDue ? nextDue.dueDate < today : false;
  return (
    <li className="min-w-0">
      <Link
        href={`/projects/${project.id}`}
        data-project-id={project.id}
        className="flex h-full card-interactive flex-col overflow-hidden card"
      >
        <span
          aria-hidden
          className="h-1 shrink-0"
          style={{ backgroundColor: colorVar(project.color) }}
        />
        <span className="flex flex-1 flex-col p-4">
          <span className="truncate type-headline-sm text-foreground">{project.name}</span>
          {project.description ? (
            <span className="mt-1 line-clamp-2 type-body-sm text-muted-foreground">
              {project.description}
            </span>
          ) : null}
          <span className="mt-auto flex flex-col gap-3 pt-4">
            <ProgressBar percent={progress.percent} label={`${project.name} progress`} />
            <span className="type-data-sm text-muted-foreground">
              {project.openCount} open · {project.doneCount} done
            </span>
            {nextDue ? (
              <span className="flex min-w-0 items-center gap-1.5 border-t border-border pt-3 type-body-sm">
                <CalendarClock
                  className={cn(
                    "size-3.5 shrink-0",
                    late ? "text-destructive" : "text-muted-foreground",
                  )}
                  strokeWidth={1.5}
                  aria-hidden
                />
                <span className="sr-only">Next due: </span>
                <span className="min-w-0 truncate text-foreground">
                  {nextDue.emoji ? <span aria-hidden>{nextDue.emoji} </span> : null}
                  {nextDue.title}
                </span>
                <span
                  className={cn(
                    "ml-auto shrink-0 type-data-sm",
                    late ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {formatDay(nextDue.dueDate, today)}
                  {late ? <span className="sr-only"> (overdue)</span> : null}
                </span>
              </span>
            ) : null}
          </span>
        </span>
      </Link>
    </li>
  );
}
