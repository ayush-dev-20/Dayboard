import { OPEN_STATUSES, type TaskStatus } from "../tasks/status";
import type { ViewConfig, ViewFilter } from "./types";

// The quick filter chips above a list (status, due, project, tag, archived) keep living in the URL,
// as they did in V1, and are laid over the current view's own filters. They are a way to narrow
// what you see right now; the view's saved filters are edited in its settings.

export type QuickParams = {
  statuses?: readonly TaskStatus[];
  /** V1's due filter: "any" | "overdue" | "today" | "upcoming" | "none". */
  due?: string;
  archived?: boolean;
  /** A project id, "none" for no project, or null. */
  projectId?: string | null;
  tagId?: string | null;
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

export function quickFilters(quick: QuickParams): ViewFilter[] {
  const out: ViewFilter[] = [];
  if (quick.statuses && !sameSet(quick.statuses, OPEN_STATUSES)) {
    out.push({ property: "status", op: "isAnyOf", value: [...quick.statuses] });
  }
  if (quick.due && quick.due !== "any") {
    out.push({ property: "dueDate", op: "inBucket", value: quick.due });
  }
  if (quick.archived) out.push({ property: "archived", op: "is", value: true });
  if (quick.projectId === "none") out.push({ property: "project", op: "isEmpty" });
  else if (quick.projectId) out.push({ property: "project", op: "is", value: quick.projectId });
  if (quick.tagId) out.push({ property: "tags", op: "is", value: quick.tagId });
  return out;
}

/** The view's config with the quick filters on top: a quick filter replaces the view's own on the same property. */
export function withQuickFilters(config: ViewConfig, quick: readonly ViewFilter[]): ViewConfig {
  if (quick.length === 0) return config;
  const taken = new Set(quick.map((f) => f.property));
  return {
    ...config,
    filters: [...config.filters.filter((f) => !taken.has(f.property)), ...quick],
  };
}

/** A filter on a project that cannot be changed from the view: a project page's own scope. */
export function projectScope(projectId: string): ViewFilter {
  return { property: "project", op: "is", value: projectId };
}
