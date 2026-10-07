// What a saved view is (V2 feature 06 §3). Pure types and vocabulary: no I/O, nothing from the
// browser, so the same definitions serve the server render, the actions' validation and the tests.

export const COLLECTIONS = ["TASKS", "TODOS", "NOTES"] as const;
export type Collection = (typeof COLLECTIONS)[number];

export const COLLECTION_LABELS: Record<Collection, string> = {
  TASKS: "Tasks",
  TODOS: "Todos",
  NOTES: "Notes",
};

export const VIEW_TYPES = ["LIST", "TABLE", "BOARD", "CALENDAR", "GALLERY", "TREE"] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export const VIEW_TYPE_LABELS: Record<ViewType, string> = {
  LIST: "List",
  TABLE: "Table",
  BOARD: "Board",
  CALENDAR: "Calendar",
  GALLERY: "Gallery",
  TREE: "Tree",
};

/** Which view types each collection can use (calendar for dated things, gallery and tree for notes). */
export const VIEW_TYPES_BY_COLLECTION: Record<Collection, readonly ViewType[]> = {
  TASKS: ["LIST", "TABLE", "BOARD", "CALENDAR"],
  TODOS: ["LIST", "TABLE", "BOARD", "CALENDAR"],
  NOTES: ["LIST", "TABLE", "BOARD", "GALLERY", "TREE"],
};

/** Types that exist in the vocabulary but are built by a later feature (Tree: 07). */
export const UNAVAILABLE_VIEW_TYPES: readonly ViewType[] = ["TREE"];

export const FILTER_OPS = [
  "is",
  "isNot",
  "isAnyOf",
  "isNoneOf",
  "isEmpty",
  "isNotEmpty",
  "contains",
  "before",
  "after",
  "between",
  "inBucket",
] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export type ViewFilter = { property: string; op: FilterOp; value?: unknown };
export type ViewSort = { property: string; dir: "asc" | "desc" };

export type OpenIn = "panel" | "page";

export type ViewConfig = {
  /** Combined with AND. */
  filters: ViewFilter[];
  /** Empty means the manual (drag) order. */
  sorts: ViewSort[];
  groupBy: string | null;
  hideEmptyGroups: boolean;
  columnOrder?: string[];
  visibleProperties: string[];
  columnWidths?: Record<string, number>;
  /** Manual column order for project and tag boards. */
  boardColumnOrder?: Record<string, string[]>;
  /** Group keys collapsed on the board (kept per view). */
  collapsedGroups?: string[];
  cardSize?: "small" | "medium" | "large";
  calendar?: { mode: "month" | "week"; showCompleted: boolean };
  openIn: OpenIn;
};

export const MAX_FILTERS = 12;
export const MAX_SORTS = 4;
export const MAX_VIEWS_PER_COLLECTION = 20;
export const VIEW_NAME_MAX = 60;

/** A saved view as the app handles it: plain values only. */
export type ViewDTO = {
  id: string;
  collection: Collection;
  name: string;
  emoji: string | null;
  type: ViewType;
  position: number;
  config: ViewConfig;
  /** The saved settings no longer passed the rules, so `config` is the type's default. Said once. */
  configReset?: boolean;
  version: number;
  updatedAt: string;
};

/** A task, todo or note as the engine reads it. See `items.ts`. */
export type Item = { id: string };
