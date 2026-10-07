import { filtersArchived } from "./filter";
import type { Collection, ViewConfig, ViewType } from "./types";

// How much of a collection a view needs read from the database (V2 feature 06 §4). Finished items
// and archived items are the bulk of a long-lived account and most views never show them, so they
// are fetched only when a filter, a board column or "show completed" could put them on screen.

const CLOSED_TASK = ["DONE", "CANCELLED"];

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return typeof value === "string" ? [value] : [];
}

/** Whether any finished item could be on screen. Conservative: when unsure, yes. */
export function mayShowClosed(collection: Collection, type: ViewType, config: ViewConfig): boolean {
  if (type === "CALENDAR" && !config.calendar?.showCompleted) return false;

  if (collection === "TASKS") {
    return config.filters
      .filter((f) => f.property === "status")
      .every((f) => {
        const values = listOf(f.value);
        switch (f.op) {
          case "is":
          case "isAnyOf":
            return values.some((v) => CLOSED_TASK.includes(v));
          case "isNot":
          case "isNoneOf":
            return !CLOSED_TASK.every((v) => values.includes(v));
          case "isEmpty":
            return false;
          default:
            return true;
        }
      });
  }
  if (collection === "TODOS") {
    return config.filters
      .filter((f) => f.property === "done")
      .every((f) => !(f.op === "is" && f.value === false));
  }
  return true;
}

export type ItemScope = { includeClosed: boolean; archivedOnly: boolean };

export function itemScope(collection: Collection, type: ViewType, config: ViewConfig): ItemScope {
  return {
    includeClosed: mayShowClosed(collection, type, config),
    archivedOnly: filtersArchived(config.filters),
  };
}

/** Changes when the set of items to read changes (the page refreshes then, and only then). */
export function scopeKey(collection: Collection, type: ViewType, config: ViewConfig): string {
  const scope = itemScope(collection, type, config);
  return `${scope.includeClosed ? 1 : 0}${scope.archivedOnly ? 1 : 0}`;
}
