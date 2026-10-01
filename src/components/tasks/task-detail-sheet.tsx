"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { DESKTOP_QUERY } from "@/hooks/use-media-query";
import type { TaskDetailDTO } from "@/lib/tasks/dto";
import { TaskDetail } from "./task-detail";
import { useCloseTask } from "./use-open-task";

/**
 * The right-docked panel (480px) on wide screens. It isn't modal: the list stays usable beside it.
 * Escape or the close button closes it and returns focus to the task's row. On narrow screens the
 * same address redirects to the full-page view.
 */
export function TaskDetailSheet({ detail }: { detail: TaskDetailDTO }) {
  const router = useRouter();
  const close = useCloseTask();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) router.replace(`/tasks/${detail.id}`);
  }, [detail.id, router]);

  // Opening moves focus into the panel so keyboard and screen-reader users land in it.
  useEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, [detail.id]);

  function closeAndRestoreFocus() {
    close();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`[data-task-id="${detail.id}"] [data-row-focus]`)
        ?.focus(),
    );
  }

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label="Task detail"
      onKeyDown={(event) => {
        // Menus and popovers handle Escape themselves (and mark it handled); only close on a bare Escape.
        if (event.key === "Escape" && !event.defaultPrevented) closeAndRestoreFocus();
      }}
      className="fixed top-12 right-0 bottom-0 z-20 hidden w-sheet overflow-y-auto border-l border-border bg-card outline-none lg:block"
    >
      <TaskDetail key={detail.id} detail={detail} variant="sheet" onClose={closeAndRestoreFocus} />
    </aside>
  );
}
