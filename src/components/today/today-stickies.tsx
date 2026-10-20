"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckButton } from "@/components/ui/check-button";
import { buttonVariants } from "@/components/ui/button";
import { completeWithUndo } from "@/components/tasks/task-actions";
import { useOpenTask } from "@/components/tasks/use-open-task";
import { ColorDot } from "@/components/workspace/tokens";
import { useOverride } from "@/hooks/use-override";
import type { TodayStickyDTO } from "@/lib/canvas/dto";
import { formatDay } from "@/lib/dates/calendar";
import { STATUS_LABELS } from "@/lib/tasks/status";
import { cn } from "@/lib/utils";

// Today's "Sticky notes" section (V3 feature 01 §13.4): open sticky notes that are In progress, or due today or overdue.
// A sticky is a task of its own kind, so it has the task's square checkbox (checking it completes it, and it moves to its
// board's Completed column), its colour dot, the due date, the board it is on, and the status in text when it is not In
// progress. The title opens the task panel. The section is not part of the day's progress or the focus picker.

function StickyRow({ row, today }: { row: TodayStickyDTO; today: string }) {
  const router = useRouter();
  const open = useOpenTask();
  const selected = useSearchParams().get("task") === row.id;
  const [done, setDone] = useOverride(false);
  const overdue = row.dueDate !== null && row.dueDate < today;

  return (
    <li
      data-sticky-id={row.id}
      className={cn(
        "flex min-h-row-touch items-center gap-1 border-b border-border md:min-h-row",
        selected && "bg-accent",
      )}
    >
      <CheckButton
        checked={done}
        label={`Complete ${row.title}`}
        onCheckedChange={(next) => {
          if (next) void completeWithUndo({ id: row.id, setDone, refresh: () => router.refresh() });
        }}
      />
      <ColorDot color={row.tone} className={cn(!row.tone && "bg-muted-foreground/40")} />
      <button
        type="button"
        onClick={() => open(row.id)}
        className={cn(
          "min-w-0 flex-1 cursor-pointer truncate px-2 text-left type-body-md hover:underline focus-visible:underline",
          done && "text-muted-foreground line-through",
        )}
      >
        {row.title}
      </button>
      {row.dueDate ? (
        <span
          className={cn(
            "shrink-0 type-body-sm",
            overdue ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {overdue ? "Overdue, " : "Due "}
          {formatDay(row.dueDate, today)}
        </span>
      ) : null}
      {row.status !== "IN_PROGRESS" ? (
        <span className="shrink-0 type-body-sm text-muted-foreground max-sm:hidden">
          {STATUS_LABELS[row.status]}
        </span>
      ) : null}
      <Link
        href={`/canvases/${row.boardId}`}
        className="max-w-36 shrink-0 truncate pl-2 type-body-sm text-muted-foreground hover:text-foreground hover:underline max-sm:hidden"
      >
        <span className="sr-only">Board: </span>
        {row.boardEmoji ? <span aria-hidden>{row.boardEmoji} </span> : null}
        {row.boardTitle || "Untitled board"}
      </Link>
    </li>
  );
}

export function TodayStickies({
  rows,
  total,
  today,
}: {
  rows: TodayStickyDTO[];
  total: number;
  today: string;
}) {
  return (
    <>
      <ul className="border-t border-border" aria-label="Sticky notes">
        {rows.map((row) => (
          <StickyRow key={row.id} row={row} today={today} />
        ))}
      </ul>
      {total > rows.length && rows[0] ? (
        <Link
          href={`/canvases/${rows[0].boardId}`}
          className={`${buttonVariants({ variant: "secondary" })} mt-2`}
        >
          Show all {total}
        </Link>
      ) : null}
    </>
  );
}
