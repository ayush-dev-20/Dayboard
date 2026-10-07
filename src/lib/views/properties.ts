import type { Collection, FilterOp } from "./types";

// Every property a view can use, in one registry (V2 feature 06 §4): filters, sorts, groups, table
// columns and card fields all read the same definition. Built-in properties only.

export type PropertyType = "text" | "select" | "multi" | "date" | "boolean" | "number";

export type PropertyDef = {
  id: string;
  label: string;
  type: PropertyType;
  ops: readonly FilterOp[];
  sortable: boolean;
  /** Not a column or card field: it only exists to filter on (archived). */
  filterOnly?: boolean;
};

const TEXT_OPS = ["contains", "is", "isNot", "isEmpty", "isNotEmpty"] as const;
const SELECT_OPS = ["is", "isNot", "isAnyOf", "isNoneOf", "isEmpty", "isNotEmpty"] as const;
const DATE_OPS = ["is", "before", "after", "between", "isEmpty", "isNotEmpty"] as const;
const DUE_OPS = [...DATE_OPS, "inBucket"] as const;
const BOOLEAN_OPS = ["is"] as const;
const NUMBER_OPS = ["is", "isNot", "before", "after"] as const;

const def = (
  id: string,
  label: string,
  type: PropertyType,
  ops: readonly FilterOp[],
  extra: Partial<PropertyDef> = {},
): PropertyDef => ({ id, label, type, ops, sortable: true, ...extra });

const archived = def("archived", "Archived", "boolean", BOOLEAN_OPS, {
  sortable: false,
  filterOnly: true,
});

export const PROPERTIES: Record<Collection, readonly PropertyDef[]> = {
  TASKS: [
    def("title", "Title", "text", TEXT_OPS),
    def("status", "Status", "select", SELECT_OPS),
    def("priority", "Priority", "select", SELECT_OPS),
    def("dueDate", "Due", "date", DUE_OPS),
    def("startDate", "Start", "date", DATE_OPS),
    def("project", "Project", "select", SELECT_OPS),
    def("tags", "Tags", "multi", SELECT_OPS),
    def("subtasks", "Subtasks", "number", NUMBER_OPS),
    def("linkedNotes", "Linked notes", "number", NUMBER_OPS),
    def("created", "Created", "date", DATE_OPS),
    def("updated", "Updated", "date", DATE_OPS),
    archived,
  ],
  TODOS: [
    def("title", "Title", "text", TEXT_OPS),
    def("done", "Done", "boolean", BOOLEAN_OPS),
    def("dueDate", "Due", "date", DUE_OPS),
    def("project", "Project", "select", SELECT_OPS),
    def("created", "Created", "date", DATE_OPS),
    archived,
  ],
  NOTES: [
    def("title", "Title", "text", TEXT_OPS),
    def("project", "Project", "select", SELECT_OPS),
    def("tags", "Tags", "multi", SELECT_OPS),
    def("linkedTasks", "Linked tasks", "number", NUMBER_OPS),
    def("created", "Created", "date", DATE_OPS),
    def("updated", "Updated", "date", DATE_OPS),
    archived,
  ],
};

export function getProperty(collection: Collection, id: string): PropertyDef | undefined {
  return PROPERTIES[collection].find((p) => p.id === id);
}

/** The properties that can be shown as a column or card field. */
export function displayProperties(collection: Collection): PropertyDef[] {
  return PROPERTIES[collection].filter((p) => !p.filterOnly);
}

export const GROUP_BY_OPTIONS: Record<Collection, readonly { id: string; label: string }[]> = {
  TASKS: [
    { id: "status", label: "Status" },
    { id: "priority", label: "Priority" },
    { id: "project", label: "Project" },
    { id: "tag", label: "Tag" },
    { id: "dueBucket", label: "Due" },
  ],
  TODOS: [
    { id: "done", label: "Done" },
    { id: "project", label: "Project" },
    { id: "dueBucket", label: "Due" },
  ],
  NOTES: [
    { id: "project", label: "Project" },
    { id: "tag", label: "Tag" },
  ],
};

/** Group-bys that exist but are not offered in the menu: the V1 list's own due groups. */
export const HIDDEN_GROUP_BY: Record<Collection, readonly string[]> = {
  TASKS: ["dueList"],
  TODOS: [],
  NOTES: [],
};

export function isValidGroupBy(collection: Collection, id: string): boolean {
  return (
    GROUP_BY_OPTIONS[collection].some((o) => o.id === id) ||
    HIDDEN_GROUP_BY[collection].includes(id)
  );
}

export const TASK_STATUS_ORDER = [
  "INBOX",
  "PLANNED",
  "IN_PROGRESS",
  "WAITING",
  "DONE",
  "CANCELLED",
];
export const TASK_PRIORITY_ORDER = ["NONE", "LOW", "MEDIUM", "HIGH"];
