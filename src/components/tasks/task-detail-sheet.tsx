"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, Minus, X, ChevronsLeft } from "lucide-react";
import { DESKTOP_QUERY } from "@/hooks/use-media-query";
import type { TaskDetailDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";
import { SheetResizeHandle } from "./sheet-resize-handle";
import { setSheetMode, useSheetMode, useSheetWidth } from "./sheet-state";
import { TaskDetail } from "./task-detail";
import { useCloseTask } from "./use-open-task";

const iconButton =
  "inline-flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground md:size-8";

/**
 * The right-docked panel on wide screens. It isn't modal: the list stays usable beside it. Drag its
 * left edge (or use the arrow keys on the handle) to resize it; Expand fills the whole content area
 * and Restore brings it back; Minimize tucks it into a small bar at the bottom right. Escape steps
 * back one level (expanded → docked) and then closes it, returning focus to the task's row. On
 * narrow screens the same address redirects to the full-page view.
 */
export function TaskDetailSheet({ detail }: { detail: TaskDetailDTO }) {
  const router = useRouter();
  const close = useCloseTask();
  const panel = useRef<HTMLElement>(null);
  const width = useSheetWidth();
  const mode = useSheetMode();

  useEffect(() => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) router.replace(`/tasks/${detail.id}`);
  }, [detail.id, router]);

  // Opening moves focus into the panel so keyboard and screen-reader users land in it.
  useEffect(() => {
    if (mode !== "minimized") panel.current?.focus({ preventScroll: true });
  }, [detail.id, mode]);

  function closeAndRestoreFocus() {
    close();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-task-id="${detail.id}"] [data-row-focus]`)
        ?.focus(),
    );
  }

  const expanded = mode === "expanded";
  const controls = (
    <>
      <button
        type="button"
        onClick={() => setSheetMode("minimized")}
        aria-label="Minimize task"
        title="Minimize"
        className={iconButton}
      >
        <Minus className="size-4" strokeWidth={1.5} aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => setSheetMode(expanded ? "docked" : "expanded")}
        aria-label={expanded ? "Restore task size" : "Expand task"}
        aria-pressed={expanded}
        title={expanded ? "Restore size" : "Expand to full width"}
        className={iconButton}
      >
        {expanded ? (
          <Minimize2 className="size-4" strokeWidth={1.5} aria-hidden />
        ) : (
          <Maximize2 className="size-4" strokeWidth={1.5} aria-hidden />
        )}
      </button>
    </>
  );

  return (
    <>
      <aside
        ref={panel}
        tabIndex={-1}
        aria-label="Task detail"
        data-mode={mode}
        onKeyDown={(event) => {
          // Menus and popovers handle Escape themselves (and mark it handled); only act on a bare Escape.
          if (event.key !== "Escape" || event.defaultPrevented) return;
          if (expanded) setSheetMode("docked");
          else closeAndRestoreFocus();
        }}
        style={expanded ? undefined : { width: `min(${width}px, calc(100vw - 724px))` }}
        className={cn(
          "fixed top-12 right-0 bottom-0 z-20 hidden overflow-y-auto border-l border-border bg-card outline-none float-surface",
          mode === "minimized" ? "lg:hidden" : "lg:block",
          expanded && "lg:left-sidebar",
        )}
      >
        {expanded ? null : <SheetResizeHandle width={width} />}
        <div className={cn(expanded && "mx-auto max-w-[800px]")}>
          <TaskDetail
            key={detail.id}
            detail={detail}
            variant="sheet"
            onClose={closeAndRestoreFocus}
            controls={controls}
          />
        </div>
      </aside>

      {mode === "minimized" ? (
        <section
          aria-label="Minimized task"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeAndRestoreFocus();
          }}
          className="fixed right-6 bottom-6 z-20 hidden max-w-sm items-center gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-3 shadow-float float-surface lg:flex"
        >
          <span className="min-w-0 truncate type-label-md text-foreground">{detail.title}</span>
          <button
            type="button"
            onClick={() => setSheetMode("docked")}
            aria-label="Restore task panel"
            title="Restore"
            className={iconButton}
          >
            <ChevronsLeft className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
          <button
            type="button"
            onClick={closeAndRestoreFocus}
            aria-label="Close task"
            className={iconButton}
          >
            <X className="size-4" strokeWidth={1.5} aria-hidden />
          </button>
        </section>
      ) : null}
    </>
  );
}
