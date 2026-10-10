"use client";

import { usePathname, useSearchParams } from "next/navigation";
import type { ContextRef } from "@/lib/ai/assistant-types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** The note, task or project the person is looking at right now, or null. Never added by itself. */
export function usePageItem(): ContextRef | null {
  const pathname = usePathname();
  const params = useSearchParams();
  const note = new RegExp(`^/notes/(${UUID})$`, "i").exec(pathname);
  if (note) return { type: "note", id: note[1]!.toLowerCase() };
  const taskPage = new RegExp(`^/tasks/(${UUID})$`, "i").exec(pathname);
  if (taskPage) return { type: "task", id: taskPage[1]!.toLowerCase() };
  const project = new RegExp(`^/projects/(${UUID})$`, "i").exec(pathname);
  if (project) return { type: "project", id: project[1]!.toLowerCase() };
  const panelTask = pathname === "/tasks" ? params.get("task") : null;
  if (panelTask && new RegExp(`^${UUID}$`, "i").test(panelTask)) {
    return { type: "task", id: panelTask.toLowerCase() };
  }
  return null;
}
