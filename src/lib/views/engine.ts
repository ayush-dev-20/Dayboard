import { applyFilters } from "./filter";
import { groupItems, type ViewGroup } from "./group";
import type { AnyItem } from "./items";
import { sortItems } from "./sort";
import type { Collection, ViewConfig } from "./types";
import type { EngineContext } from "./values";

// The view engine (V2 feature 06 §4): items and a config in, groups out. Pure and synchronous, so
// the server render and (once the local database exists) the browser run the very same code.

export type ViewResult<T> = {
  groups: ViewGroup<T>[];
  /** Everything that matched, sorted, once (a group by tag shows an item in several groups). */
  items: T[];
  /** How many distinct items matched. */
  total: number;
};

export function runView<T extends AnyItem>(
  collection: Collection,
  items: readonly T[],
  config: ViewConfig,
  ctx: EngineContext,
): ViewResult<T> {
  const matched = applyFilters(collection, items, config.filters, ctx);
  const sorted = sortItems(collection, matched, config.sorts, ctx);
  const groups = groupItems(collection, sorted, config, ctx);
  return { groups, items: sorted, total: sorted.length };
}

/** How many items a group or table shows before "Show more". */
export const PAGE_SIZE = 50;

/** The first `shown` items of a group, and how many are left. */
export function pageOf<T>(items: readonly T[], shown: number): { visible: T[]; rest: number } {
  return { visible: items.slice(0, shown), rest: Math.max(items.length - shown, 0) };
}
