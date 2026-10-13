// What the update banner shows (V2 feature 03 §5). Pure, so the rule is unit-tested.
export type UpdateView = "hidden" | "ready" | "deferred";

/**
 * Hidden until a new version is waiting. Then "Reload" while nothing is unsaved, and
 * "Reload when you finish" while a note or form still has changes that have not synced.
 */
export function updateView(input: { waiting: boolean; unsaved: boolean }): UpdateView {
  if (!input.waiting) return "hidden";
  return input.unsaved ? "deferred" : "ready";
}
