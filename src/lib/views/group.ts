import type { ColorToken } from "../colors";
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from "../tasks/status";
import { DUE_BUCKET_LABELS, DUE_BUCKETS } from "./due-buckets";
import type { AnyItem, ViewNote, ViewTask } from "./items";
import type { Collection, ViewConfig } from "./types";
import { dueBucketFor, type EngineContext } from "./values";

// Grouping (V2 feature 06 §4): the board's columns, the table's groups, the list's sections. Fixed
// domains (status, priority, due, done) always have every group, in a fixed order; projects and
// tags have one group each (all of the person's, even empty ones) in their manual or name order; an
// item with no value goes to a "No value" group. A task appears in each of its tags' groups.

export type ViewGroup<T> = {
  key: string;
  label: string;
  items: T[];
  color?: ColorToken | null;
  /** The "No project" / "No tag" / "No date" group. */
  empty?: boolean;
  /** Dropping a card here means something. False for Overdue and Completed. */
  droppable: boolean;
};

export const NO_VALUE_KEY = "none";

type Mutable<T> = ViewGroup<T>;

function fixedGroups<T>(
  keys: readonly string[],
  label: (key: string) => string,
  droppable: (key: string) => boolean = () => true,
): Map<string, Mutable<T>> {
  return new Map(
    keys.map((key) => [key, { key, label: label(key), items: [], droppable: droppable(key) }]),
  );
}

const nameCollator = new Intl.Collator(undefined, { sensitivity: "base" });

function sortByManualThenName<T extends { id: string; name: string }>(
  list: readonly T[],
  manual: readonly string[] | undefined,
): T[] {
  const rank = new Map((manual ?? []).map((id, i) => [id, i]));
  return [...list].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra !== undefined && rb !== undefined) return ra - rb;
    if (ra !== undefined) return -1;
    if (rb !== undefined) return 1;
    return nameCollator.compare(a.name, b.name);
  });
}

/** The order columns appear in for project and tag grouping: manual first, then by name. */
export function orderedGroupKeys<T>(groups: readonly ViewGroup<T>[]): string[] {
  return groups.filter((g) => !g.empty).map((g) => g.key);
}

export function groupItems<T extends AnyItem>(
  collection: Collection,
  items: readonly T[],
  config: Pick<ViewConfig, "groupBy" | "hideEmptyGroups" | "boardColumnOrder">,
  ctx: EngineContext,
): ViewGroup<T>[] {
  const by = config.groupBy;
  if (!by) return [{ key: "all", label: "", items: [...items], droppable: false }];

  let groups: Map<string, Mutable<T>>;

  if (by === "status") {
    groups = fixedGroups(TASK_STATUSES, (k) => STATUS_LABELS[k as keyof typeof STATUS_LABELS]);
    for (const item of items) groups.get((item as ViewTask).status)?.items.push(item);
  } else if (by === "priority") {
    const order = [...TASK_PRIORITIES].reverse();
    groups = fixedGroups(order, (k) => PRIORITY_LABELS[k as keyof typeof PRIORITY_LABELS]);
    for (const item of items) groups.get((item as ViewTask).priority)?.items.push(item);
  } else if (by === "done") {
    groups = fixedGroups(["open", "done"], (k) => (k === "done" ? "Done" : "Not done"));
    for (const item of items) {
      groups
        .get((item as unknown as { isComplete: boolean }).isComplete ? "done" : "open")
        ?.items.push(item);
    }
  } else if (by === "dueBucket") {
    groups = fixedGroups(
      DUE_BUCKETS,
      (k) => DUE_BUCKET_LABELS[k as keyof typeof DUE_BUCKET_LABELS],
      (k) => k !== "overdue",
    );
    groups.get("none")!.empty = true;
    const completed: Mutable<T> = {
      key: "done",
      label: DUE_BUCKET_LABELS.done,
      items: [],
      droppable: false,
    };
    for (const item of items) {
      const bucket = dueBucketFor(collection, item, ctx);
      (bucket === "done" ? completed : groups.get(bucket))?.items.push(item);
    }
    if (completed.items.length > 0) groups.set("done", completed);
  } else if (by === "dueList") {
    // The V1 task list's groups: Overdue, Today, Upcoming, No date. Finished tasks go to Completed.
    groups = fixedGroups(
      ["overdue", "today", "upcoming", "none"],
      (k) =>
        k === "none"
          ? "No date"
          : k === "upcoming"
            ? "Upcoming"
            : k === "today"
              ? "Today"
              : "Overdue",
      (k) => k !== "overdue",
    );
    groups.get("none")!.empty = true;
    const completed: Mutable<T> = {
      key: "done",
      label: DUE_BUCKET_LABELS.done,
      items: [],
      droppable: false,
    };
    for (const item of items) {
      const bucket = dueBucketFor(collection, item, ctx);
      if (bucket === "done") completed.items.push(item);
      else if (bucket === "none") groups.get("none")!.items.push(item);
      else if (bucket === "overdue") groups.get("overdue")!.items.push(item);
      else if (bucket === "today") groups.get("today")!.items.push(item);
      else groups.get("upcoming")!.items.push(item);
    }
    if (completed.items.length > 0) groups.set("done", completed);
  } else if (by === "project") {
    const known = new Map<string, { id: string; name: string; color: ColorToken | null }>();
    for (const p of ctx.projects) known.set(p.id, p);
    for (const item of items) if (item.project) known.set(item.project.id, item.project);
    groups = new Map();
    for (const p of sortByManualThenName([...known.values()], config.boardColumnOrder?.project)) {
      groups.set(p.id, { key: p.id, label: p.name, color: p.color, items: [], droppable: true });
    }
    groups.set(NO_VALUE_KEY, {
      key: NO_VALUE_KEY,
      label: "No project",
      items: [],
      droppable: true,
      empty: true,
    });
    for (const item of items) groups.get(item.project?.id ?? NO_VALUE_KEY)?.items.push(item);
  } else if (by === "tag") {
    const known = new Map<string, { id: string; name: string; color: ColorToken | null }>();
    for (const t of ctx.tags) known.set(t.id, t);
    for (const item of items)
      for (const t of (item as ViewTask | ViewNote).tags) known.set(t.id, t);
    groups = new Map();
    for (const t of sortByManualThenName([...known.values()], config.boardColumnOrder?.tag)) {
      groups.set(t.id, { key: t.id, label: t.name, color: t.color, items: [], droppable: true });
    }
    groups.set(NO_VALUE_KEY, {
      key: NO_VALUE_KEY,
      label: "No tag",
      items: [],
      droppable: true,
      empty: true,
    });
    for (const item of items) {
      const tags = (item as ViewTask | ViewNote).tags;
      if (tags.length === 0) groups.get(NO_VALUE_KEY)?.items.push(item);
      else for (const t of tags) groups.get(t.id)?.items.push(item);
    }
  } else {
    return [{ key: "all", label: "", items: [...items], droppable: false }];
  }

  const list = [...groups.values()];
  return config.hideEmptyGroups ? list.filter((g) => g.items.length > 0) : list;
}
