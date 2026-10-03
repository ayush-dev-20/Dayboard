"use client";

import { cn } from "@/lib/utils";
import { useSheetMode, useSheetWidth } from "./sheet-state";

/**
 * Wraps the Tasks page content. While the task panel is docked beside it, the list keeps clear of
 * the panel by as much as the panel is wide (so resizing the panel resizes the gap). Expanded or
 * minimized, the list has the full width. Only on wide screens, where the panel is a side panel.
 */
export function TaskListShell({
  sheetOpen,
  children,
}: {
  sheetOpen: boolean;
  children: React.ReactNode;
}) {
  const width = useSheetWidth();
  const mode = useSheetMode();
  const reserve = sheetOpen && mode === "docked";

  return (
    // The padding goes on an outer box and the width cap on the inner one, so the cap measures the
    // list itself and not the list plus the gap kept for the panel. Centered when the panel is
    // closed; left-aligned beside it, so the list doesn't slide under the panel.
    <div
      className={cn(reserve && "lg:pr-(--sheet-gap)")}
      style={
        reserve
          ? ({
              "--sheet-gap": `min(${width}px, calc(100vw - var(--sidebar-width, 240px) - 484px))`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <div className={cn("w-full max-w-content", reserve ? "lg:mx-0" : "mx-auto")}>{children}</div>
    </div>
  );
}
