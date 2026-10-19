"use client";

import { useSheetMode } from "@/components/tasks/sheet-state";
import { TaskListShell } from "@/components/tasks/task-list-shell";
import { cn } from "@/lib/utils";

/**
 * Today with the task panel open beside it. While the panel is docked, the day keeps clear of it by as much as
 * the panel is wide (the same shell the Tasks page uses), and the two columns stack: a day squeezed beside a
 * panel has no room for a rail next to its lists. Expanded or minimized, Today looks as it always does.
 */
export function TodayShell({
  sheetOpen,
  children,
}: {
  sheetOpen: boolean;
  children: React.ReactNode;
}) {
  return (
    <TaskListShell sheetOpen={sheetOpen} wide>
      {children}
    </TaskListShell>
  );
}

/** The two-column Today at ≥ 1280px (main and a 320px rail), one column below it or beside the open panel. */
export function TodayGrid({
  sheetOpen,
  main,
  rail,
}: {
  sheetOpen: boolean;
  main: React.ReactNode;
  rail: React.ReactNode;
}) {
  const mode = useSheetMode();
  const stacked = sheetOpen && mode === "docked";
  return (
    <div
      className={cn(
        !stacked &&
          "xl:grid xl:grid-cols-[minmax(0,720px)_var(--spacing-today-rail)] xl:justify-between xl:gap-12",
      )}
    >
      <div className="min-w-0">{main}</div>
      <div className={cn("mt-12", !stacked && "xl:mt-0")}>{rail}</div>
    </div>
  );
}
