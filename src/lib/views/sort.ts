import type { AnyItem } from "./items";
import type { Collection, ViewSort } from "./types";
import { getSortKey, manualCompare, type EngineContext } from "./values";

// Sorts (V2 feature 06 §4): stable, any number of properties, and an empty list means the person's
// own manual order. Items with no value for a property come last, whichever way it is sorted.

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareKeys(
  a: string | number | boolean | null,
  b: string | number | boolean | null,
  dir: "asc" | "desc",
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let result: number;
  if (typeof a === "string" && typeof b === "string") {
    result = collator.compare(a, b);
  } else {
    result = a < b ? -1 : a > b ? 1 : 0;
  }
  return dir === "asc" ? result : -result;
}

export function sortItems<T extends AnyItem>(
  collection: Collection,
  items: readonly T[],
  sorts: readonly ViewSort[],
  ctx: EngineContext,
): T[] {
  // Decorate once so each key is read once per item, not once per comparison.
  const decorated = items.map((item, index) => ({
    item,
    index,
    keys: sorts.map((s) => getSortKey(collection, item, s.property, ctx)),
  }));
  decorated.sort((x, y) => {
    if (sorts.length === 0) return manualCompare(x.item, y.item) || x.index - y.index;
    for (let i = 0; i < sorts.length; i += 1) {
      const result = compareKeys(x.keys[i]!, y.keys[i]!, sorts[i]!.dir);
      if (result !== 0) return result;
    }
    // Ties keep the manual order, so the result never depends on how the engine was fed.
    return manualCompare(x.item, y.item) || x.index - y.index;
  });
  return decorated.map((d) => d.item);
}
