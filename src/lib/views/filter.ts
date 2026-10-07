import { compareDates } from "../dates/calendar";
import { clockFor, FILTER_BUCKETS, inFilterBucket, type FilterBucket } from "./due-buckets";
import type { AnyItem, ViewNote, ViewTask, ViewTodo } from "./items";
import { getProperty } from "./properties";
import type { Collection, ViewFilter } from "./types";
import { getValue, isOpenItem, type EngineContext } from "./values";

// Filters (V2 feature 06 §4). Combined with AND. A filter on an unknown property, or with an
// operator that does not fit the property, matches nothing instead of throwing: a saved view must
// never break a page.

const TODAY_TOKEN = "@today";

/** A date filter value: "YYYY-MM-DD", or "@today" for the person's own today. */
function resolveDate(value: unknown, ctx: EngineContext): string | null {
  if (typeof value !== "string") return null;
  if (value === TODAY_TOKEN) return clockFor(ctx).today;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

const isEmptyValue = (value: unknown): boolean =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function matchesFilter(
  collection: Collection,
  item: AnyItem,
  filter: ViewFilter,
  ctx: EngineContext,
): boolean {
  const property = getProperty(collection, filter.property);
  if (!property || !property.ops.includes(filter.op)) return false;
  const raw = getValue(collection, item, filter.property, ctx);

  switch (filter.op) {
    case "isEmpty":
      return isEmptyValue(raw);
    case "isNotEmpty":
      return !isEmptyValue(raw);
  }

  if (property.type === "boolean") return raw === filter.value;

  if (property.type === "text") {
    const text = String(raw ?? "").toLocaleLowerCase();
    const want = String(filter.value ?? "").toLocaleLowerCase();
    if (filter.op === "contains") return want === "" || text.includes(want);
    if (filter.op === "is") return text === want;
    if (filter.op === "isNot") return text !== want;
    return false;
  }

  if (property.type === "number") {
    const n = typeof raw === "number" ? raw : 0;
    const want = typeof filter.value === "number" ? filter.value : Number.NaN;
    if (Number.isNaN(want)) return false;
    if (filter.op === "is") return n === want;
    if (filter.op === "isNot") return n !== want;
    if (filter.op === "before") return n < want;
    if (filter.op === "after") return n > want;
    return false;
  }

  if (property.type === "date") {
    if (filter.op === "inBucket") {
      const bucket = filter.value as FilterBucket;
      if (!(FILTER_BUCKETS as readonly string[]).includes(bucket)) return false;
      const task = item as ViewTask | ViewTodo;
      return inFilterBucket(
        {
          dueDate: task.dueDate,
          dueTime: collection === "TASKS" ? (item as ViewTask).dueTime : null,
          open: isOpenItem(collection, item),
        },
        bucket,
        clockFor(ctx),
      );
    }
    if (typeof raw !== "string") return false;
    if (filter.op === "between") {
      const [a, b] = Array.isArray(filter.value) ? filter.value : [];
      const from = resolveDate(a, ctx);
      const to = resolveDate(b, ctx);
      return (
        from !== null && to !== null && compareDates(raw, from) >= 0 && compareDates(raw, to) <= 0
      );
    }
    const want = resolveDate(filter.value, ctx);
    if (want === null) return false;
    if (filter.op === "is") return raw === want;
    if (filter.op === "isNot") return raw !== want;
    if (filter.op === "before") return compareDates(raw, want) < 0;
    if (filter.op === "after") return compareDates(raw, want) > 0;
    return false;
  }

  // select and multi: the item's value (or values) against one id or a list of ids.
  const have = Array.isArray(raw) ? raw : raw === null ? [] : [String(raw)];
  switch (filter.op) {
    case "is":
      return typeof filter.value === "string" && have.includes(filter.value);
    case "isNot":
      return typeof filter.value === "string" && !have.includes(filter.value);
    case "isAnyOf":
      return asList(filter.value).some((id) => have.includes(id));
    case "isNoneOf":
      return !asList(filter.value).some((id) => have.includes(id));
    default:
      return false;
  }
}

/** A view that filters on archived looks at archived items; any other view never shows them. */
export function filtersArchived(filters: readonly ViewFilter[]): boolean {
  return filters.some((f) => f.property === "archived");
}

export function applyFilters<T extends AnyItem>(
  collection: Collection,
  items: readonly T[],
  filters: readonly ViewFilter[],
  ctx: EngineContext,
): T[] {
  const showsArchived = filtersArchived(filters);
  return items.filter(
    (item) =>
      (showsArchived || !item.archived) &&
      filters.every((filter) => matchesFilter(collection, item, filter, ctx)),
  );
}

export type { ViewNote };
