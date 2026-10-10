"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { gentle } from "@/lib/motion";
import { Maximize2, Minimize2, Minus, X, ChevronsLeft } from "lucide-react";
import { DESKTOP_QUERY } from "@/hooks/use-media-query";
import type { TaskDetailDTO } from "@/lib/tasks/dto";
import { cn } from "@/lib/utils";
import { useTaskPanelPresence } from "@/components/assistant/launcher-state";
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
  // Under reduced motion it starts in place (no offset at all), so not even one frame is shifted.
  const reduce = useReducedMotion();
  // The floating chat button keeps to the left of this panel (feature 11 §6A).
  useTaskPanelPresence(true);

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
      <motion.aside
        ref={panel}
        // Slides in from the right on the gentle spring; resizing by drag is direct (no animation).
        initial={reduce ? { opacity: 0 } : { opacity: 0, x: 24 }}
        animate={{ opacity: 1, x: 0 }}
        transition={gentle}
        tabIndex={-1}
        aria-label="Task detail"
        data-mode={mode}
        onKeyDown={(event) => {
          // Menus and popovers handle Escape themselves (and mark it handled); only act on a bare Escape.
          if (event.key !== "Escape" || event.defaultPrevented) return;
          if (expanded) setSheetMode("docked");
          else closeAndRestoreFocus();
        }}
        style={
          expanded
            ? undefined
            : { width: `min(${width}px, calc(100vw - var(--sidebar-width, 240px) - 484px))` }
        }
        className={cn(
          // Docks to the right edge of the inset main panel, under its top bar (DESIGN.md: Layout).
          "fixed top-[calc(0.5rem+3rem+1px)] right-[calc(0.5rem+1px)] bottom-0 z-40 hidden overflow-y-auto border-l border-border bg-card shadow-md outline-none float-surface",
          mode === "minimized" ? "lg:hidden" : "lg:block",
          expanded && "lg:left-[calc(var(--sidebar-width,240px)+1px)]",
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
      </motion.aside>

      {mode === "minimized" ? (
        <section
          aria-label="Minimized task"
          onKeyDown={(event) => {
            if (event.key === "Escape") closeAndRestoreFocus();
          }}
          className="fixed right-6 bottom-6 z-40 hidden max-w-sm items-center gap-1 rounded-lg border border-border bg-card py-1 pr-1 pl-3 shadow-float float-surface lg:flex"
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
