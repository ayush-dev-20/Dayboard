"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DESKTOP_QUERY } from "@/hooks/use-media-query";
import { setSheetMode } from "./sheet-state";

/**
 * The page the task panel docks to: Today and a canvas have their own (the panel opens beside the day or the
 * drawing, not on the Tasks page), and every other page uses the Tasks page.
 */
export function useTaskPanelPath(): string {
  const pathname = usePathname();
  if (pathname === "/today") return "/today";
  if (/^\/canvases\/[^/]+$/.test(pathname)) return pathname;
  return "/tasks";
}

/**
 * Opening a task: a side sheet on wide screens (`?task=id` on the page it is opened from, so the Back
 * button closes it and the link works), a full page on narrow ones (`/tasks/id`).
 */
export function useOpenTask() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const base = useTaskPanelPath();

  return useCallback(
    (id: string) => {
      // Choosing a task always brings the panel back to its normal docked size.
      setSheetMode("docked");
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        const next = new URLSearchParams(searchParams.toString());
        next.set("task", id);
        router.push(`${base}?${next.toString()}`, { scroll: false });
      } else {
        router.push(`/tasks/${id}`);
      }
    },
    [router, searchParams, base],
  );
}

export function useCloseTask() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const base = useTaskPanelPath();

  return useCallback(() => {
    setSheetMode("docked");
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    const query = next.toString();
    router.push(query ? `${base}?${query}` : base, { scroll: false });
  }, [router, searchParams, base]);
}
