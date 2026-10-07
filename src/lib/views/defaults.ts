import { OPEN_STATUSES } from "../tasks/status";
import type { Collection, ViewConfig, ViewDTO, ViewFilter, ViewType } from "./types";

// What a new view starts as (V2 feature 06 §5). The List defaults here are also written, as JSON,
// into the backfill migration; a unit test keeps the two in step.

export const DEFAULT_VIEW_NAMES: Record<Collection, string> = {
  TASKS: "All tasks",
  TODOS: "All todos",
  NOTES: "All notes",
};

const NOTES_UPDATED_FIRST: ViewConfig["sorts"] = [{ property: "updated", dir: "desc" }];

const OPEN_ONLY: ViewFilter = { property: "status", op: "isAnyOf", value: [...OPEN_STATUSES] };
const TODO_OPEN: ViewFilter = { property: "done", op: "is", value: false };

/** The config a view of this type starts with. Always a fresh object. */
export function defaultConfig(collection: Collection, type: ViewType): ViewConfig {
  const base: ViewConfig = {
    filters: [],
    sorts: [],
    groupBy: null,
    hideEmptyGroups: false,
    visibleProperties: [],
    openIn: collection === "NOTES" ? "page" : "panel",
  };

  switch (`${collection}:${type}`) {
    case "TASKS:LIST":
      return { ...base, groupBy: "dueList", hideEmptyGroups: true };
    case "TODOS:LIST":
      return base;
    case "NOTES:LIST":
      return { ...base, sorts: NOTES_UPDATED_FIRST };

    case "TASKS:TABLE":
      return {
        ...base,
        filters: [OPEN_ONLY],
        visibleProperties: ["title", "status", "priority", "dueDate", "project", "tags"],
      };
    case "TODOS:TABLE":
      return {
        ...base,
        filters: [TODO_OPEN],
        visibleProperties: ["title", "done", "dueDate", "project"],
      };
    case "NOTES:TABLE":
      return {
        ...base,
        sorts: NOTES_UPDATED_FIRST,
        visibleProperties: ["title", "project", "tags", "updated"],
      };

    case "TASKS:BOARD":
      return {
        ...base,
        groupBy: "status",
        collapsedGroups: ["DONE", "CANCELLED"],
        visibleProperties: ["dueDate", "priority", "tags", "subtasks", "project"],
      };
    case "TODOS:BOARD":
      return { ...base, groupBy: "done", visibleProperties: ["dueDate", "project"] };
    case "NOTES:BOARD":
      return { ...base, groupBy: "project", visibleProperties: ["tags", "updated"] };

    case "TASKS:CALENDAR":
    case "TODOS:CALENDAR":
      return { ...base, calendar: { mode: "month", showCompleted: false } };

    case "NOTES:GALLERY":
      return { ...base, sorts: NOTES_UPDATED_FIRST, cardSize: "medium" };

    default:
      return base;
  }
}

export const NEW_VIEW_NAMES: Record<ViewType, string> = {
  LIST: "List",
  TABLE: "Table",
  BOARD: "Board",
  CALENDAR: "Calendar",
  GALLERY: "Gallery",
  TREE: "Tree",
};

export type ReadyMade = { id: string; label: string; type: ViewType; name: string };

/** The starting points offered in "+ View" besides the plain types (feature doc §5). */
export function readyMadeStarts(collection: Collection): ReadyMade[] {
  if (collection === "TASKS") {
    return [
      { id: "board-status", label: "Board by status", type: "BOARD", name: "Board by status" },
      { id: "table", label: "Table", type: "TABLE", name: "Table" },
      { id: "calendar", label: "Calendar", type: "CALENDAR", name: "Calendar" },
    ];
  }
  if (collection === "TODOS") {
    return [
      { id: "board-done", label: "Board by done", type: "BOARD", name: "Board by done" },
      { id: "table", label: "Table", type: "TABLE", name: "Table" },
      { id: "calendar", label: "Calendar", type: "CALENDAR", name: "Calendar" },
    ];
  }
  return [
    { id: "board-project", label: "Board by project", type: "BOARD", name: "Board by project" },
    { id: "table", label: "Table", type: "TABLE", name: "Table" },
    { id: "gallery", label: "Gallery", type: "GALLERY", name: "Gallery" },
  ];
}

/**
 * A new view of `type` that starts from the current view's filters (feature doc §5). Where the
 * current view has no filters the type's own defaults apply (a table of open tasks, say).
 */
export function newViewStart(
  collection: Collection,
  type: ViewType,
  currentFilters: readonly ViewFilter[],
): ViewConfig {
  const config = defaultConfig(collection, type);
  if (currentFilters.length > 0) config.filters = currentFilters.map((f) => ({ ...f }));
  return config;
}

/** The three views every account has, in tab order (also what sign-up creates). */
export function defaultViewSet(): {
  collection: Collection;
  name: string;
  type: ViewType;
  config: ViewConfig;
}[] {
  return (["TASKS", "TODOS", "NOTES"] as const).map((collection) => ({
    collection,
    name: DEFAULT_VIEW_NAMES[collection],
    type: "LIST" as const,
    config: defaultConfig(collection, "LIST"),
  }));
}

export type ViewSummary = Pick<ViewDTO, "id" | "name" | "type" | "emoji">;

/** "Sorted by Due, then Title", or the manual order when nothing is set. */
export function describeSorts(
  labels: Record<string, string>,
  sorts: readonly { property: string; dir: "asc" | "desc" }[],
  manual = "Sorted by your order",
): string {
  if (sorts.length === 0) return manual;
  return `Sorted by ${sorts
    .map((s) => `${labels[s.property] ?? s.property}${s.dir === "desc" ? " (descending)" : ""}`)
    .join(", then ")}`;
}
