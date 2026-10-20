import Link from "next/link";
import { Kanban, Shapes } from "lucide-react";
import { ProjectToken } from "@/components/workspace/tokens";
import type { CanvasListItemDTO } from "@/lib/canvas/dto";
import { formatCompact } from "@/lib/dates/relative";
import { cn } from "@/lib/utils";

/** "24 elements", "Empty", "18 sticky notes": what is on it, in words. */
export function describeContents(
  canvas: Pick<CanvasListItemDTO, "kind" | "elementCount" | "stickyCount">,
): string {
  if (canvas.kind === "BOARD") {
    const n = canvas.stickyCount ?? 0;
    return n === 0 ? "No sticky notes" : `${n} sticky ${n === 1 ? "note" : "notes"}`;
  }
  const n = canvas.elementCount;
  return n === 0 ? "Empty" : `${n} ${n === 1 ? "element" : "elements"}`;
}

/**
 * One row per canvas: emoji (or a shapes icon), title, a Board marker in text for a sticky board, the project, what is
 * on it and when it changed. A row, not a card (UI/UX §6); the whole row is the link.
 */
export function CanvasRow({
  canvas,
  now,
  timeZone,
  className,
}: {
  canvas: CanvasListItemDTO;
  now: Date;
  timeZone: string;
  className?: string;
}) {
  const Icon = canvas.kind === "BOARD" ? Kanban : Shapes;
  return (
    <li className={cn("border-b border-border", className)}>
      <Link
        href={`/canvases/${canvas.id}`}
        className="flex min-h-row-touch items-center gap-2 px-3 py-2 transition-colors duration-[120ms] hover:bg-accent md:min-h-row md:py-1"
      >
        <span aria-hidden className="inline-flex w-5 shrink-0 justify-center">
          {canvas.emoji ?? <Icon className="size-4 text-muted-foreground" strokeWidth={1.5} />}
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-3 pr-2">
          <span className="min-w-0 truncate text-[16px] max-md:shrink md:shrink-0 md:text-[14px]">
            {canvas.title || "Untitled canvas"}
          </span>
          {canvas.kind === "BOARD" ? (
            <span className="shrink-0 type-body-sm text-muted-foreground">Board</span>
          ) : null}
          <span className="hidden min-w-0 truncate type-body-sm text-muted-foreground md:inline">
            {describeContents(canvas)}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-3">
          {canvas.project ? (
            <span className="flex max-w-32 min-w-0">
              <span className="sr-only">Project: </span>
              <ProjectToken project={canvas.project} />
            </span>
          ) : null}
          <time
            dateTime={canvas.updatedAt}
            className="w-14 text-right type-data-sm text-muted-foreground"
          >
            <span className="sr-only">Updated </span>
            {formatCompact(new Date(canvas.updatedAt), now, timeZone)}
          </time>
        </span>
      </Link>
    </li>
  );
}
