"use client";

import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { DESKTOP_QUERY } from "@/hooks/use-media-query";

/**
 * Opening a task: a side sheet on wide screens (`/tasks?task=id`, so the Back button closes it and
 * the link works), a full page on narrow ones (`/tasks/id`).
 */
export function useOpenTask() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return useCallback(
    (id: string) => {
      if (window.matchMedia(DESKTOP_QUERY).matches) {
        const next = new URLSearchParams(searchParams.toString());
        next.set("task", id);
        router.push(`/tasks?${next.toString()}`, { scroll: false });
      } else {
        router.push(`/tasks/${id}`);
      }
    },
    [router, searchParams],
  );
}

export function useCloseTask() {
  const router = useRouter();
  const searchParams = useSearchParams();

  return useCallback(() => {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("task");
    const query = next.toString();
    router.push(query ? `/tasks?${query}` : "/tasks", { scroll: false });
  }, [router, searchParams]);
}
