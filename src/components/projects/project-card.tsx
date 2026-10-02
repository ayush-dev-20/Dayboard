import Link from "next/link";
import { ColorDot } from "@/components/workspace/tokens";
import type { ProjectSummaryDTO } from "@/lib/projects/dto";
import { projectProgress } from "@/lib/projects/progress";
import { ProgressBar } from "./progress-bar";

/** One project as a row: colour, name, how many items are open, and progress. A row, not a card. */
export function ProjectCard({ project }: { project: ProjectSummaryDTO }) {
  const progress = projectProgress({
    done: project.doneCount,
    cancelled: project.cancelledCount,
    total: project.totalCount,
  });
  return (
    <li className="border-b border-border">
      <Link
        href={`/projects/${project.id}`}
        className="block px-3 py-3 transition-colors duration-[120ms] hover:bg-accent"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="flex min-w-0 items-center gap-2 text-[16px] md:text-[14px]">
            <ColorDot color={project.color} />
            <span className="truncate">{project.name}</span>
          </span>
          <span className="shrink-0 type-data-sm text-muted-foreground">
            {project.openCount} open
          </span>
        </span>
        <ProgressBar
          percent={progress.percent}
          className="mt-2"
          label={`${project.name} progress`}
        />
      </Link>
    </li>
  );
}
