import type { ProjectRef } from "@/lib/projects/dto";
import type { TagDTO } from "@/lib/tags";
import type { ViewNote, ViewTask, ViewTodo } from "@/lib/views/items";
import type { EngineContext } from "@/lib/views/values";

// Small builders for the view engine's tests.

let seq = 0;
const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

export const project = (name: string, color: ProjectRef["color"] = "blue"): ProjectRef => ({
  id: id(),
  name,
  color,
  status: "ACTIVE",
});
export const tag = (name: string): TagDTO => ({ id: id(), name, color: null });

export function task(over: Partial<ViewTask> = {}): ViewTask {
  const n = ++seq;
  return {
    id: id(),
    parentTaskId: null,
    title: `Task ${n}`,
    emoji: null,
    status: "PLANNED",
    priority: "NONE",
    dueDate: null,
    dueTime: null,
    startDate: null,
    startTime: null,
    recurrenceRule: null,
    sortOrder: n * 1024,
    archived: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    completedAt: null,
    subtaskTotal: 0,
    subtaskDone: 0,
    project: null,
    tags: [],
    noteCount: 0,
    ...over,
  };
}

export function todo(over: Partial<ViewTodo> = {}): ViewTodo {
  const n = ++seq;
  return {
    id: id(),
    title: `Todo ${n}`,
    emoji: null,
    isComplete: false,
    completedAt: null,
    dueDate: null,
    sortOrder: n * 1024,
    archived: false,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    project: null,
    ...over,
  };
}

export function note(over: Partial<ViewNote> = {}): ViewNote {
  const n = ++seq;
  return {
    id: id(),
    title: `Note ${n}`,
    emoji: null,
    snippet: "",
    updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, n)).toISOString(),
    archived: false,
    project: null,
    tags: [],
    sortOrder: n * 1024,
    taskCount: 0,
    version: 1,
    ...over,
  };
}

/** 2026-10-07 is a Wednesday. UTC, day starts at midnight, so dates read plainly. */
export const NOW = new Date("2026-10-07T12:00:00Z");
export const TODAY = "2026-10-07";

export function ctx(over: Partial<EngineContext> = {}): EngineContext {
  return {
    prefs: { timezone: "UTC", startOfDay: "00:00" },
    now: NOW,
    weekStart: 1,
    projects: [],
    tags: [],
    ...over,
  };
}
