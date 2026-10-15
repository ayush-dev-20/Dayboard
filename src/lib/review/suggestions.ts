import type { ReviewSuggestionsOutput } from "@/lib/ai/schemas";
import { resolveDuePhrase } from "@/lib/dates/resolve";
import {
  LIMITS,
  type FactKey,
  type FactRef,
  type ReviewFacts,
  type ReviewSuggestions,
} from "./types";

// What the server does with the model's suggestions before anyone sees them (V2 feature 15 §5): every id must be
// one the review really holds, a date must resolve to today or later, text is capped, and what fails is dropped.
// If nothing is left the suggestions are treated as unavailable (null). The model never changes a fact. Pure.

const clip = (value: string, max: number) => value.trim().slice(0, max).trim();

/** The ids each fact holds, which is all a suggestion may point at. */
export function knownIds(facts: ReviewFacts): Record<FactKey, Set<string>> {
  return {
    completed: new Set(facts.completed.recent.map((c) => c.id)),
    overdue: new Set(facts.overdue.items.map((t) => t.id)),
    notes: new Set(facts.notes.titles.map((n) => n.id)),
    projects: new Set([
      ...facts.projects.active.map((p) => p.id),
      ...facts.projects.quiet.map((p) => p.id),
    ]),
    calendar: new Set(),
    postponements: new Set(facts.postponements.items.map((p) => p.taskId)),
    inbox: new Set(),
  };
}

/** Whether the review has this fact to point at (a calendar that is not connected is not a fact). */
function hasFact(facts: ReviewFacts, key: FactKey): boolean {
  if (key === "calendar") return facts.calendar !== null;
  if (key === "postponements") return facts.postponements.enough;
  return true;
}

/** The tasks a suggestion may be about: the carry-forward ones and the ones moved later repeatedly. */
export function relevantTasks(facts: ReviewFacts): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of facts.overdue.items) out.set(t.id, t.title);
  for (const p of facts.postponements.items) if (!out.has(p.taskId)) out.set(p.taskId, p.title);
  return out;
}

export function validateSuggestions(
  raw: ReviewSuggestionsOutput,
  facts: ReviewFacts,
  today: string,
): ReviewSuggestions | null {
  const known = knownIds(facts);
  const tasks = relevantTasks(facts);
  const carriable = new Set(facts.overdue.items.map((t) => t.id));
  for (const p of facts.postponements.items) carriable.add(p.taskId);

  const refs = (list: ReviewSuggestionsOutput["focusAreas"][number]["basedOn"]): FactRef[] => {
    const out: FactRef[] = [];
    for (const ref of list) {
      if (!hasFact(facts, ref.fact)) continue;
      const ids = (ref.ids ?? []).filter((id) => known[ref.fact].has(id));
      out.push({ fact: ref.fact, ids: [...new Set(ids)] });
    }
    return out;
  };

  const focusAreas = raw.focusAreas
    .map((area) => ({
      title: clip(area.title, 120),
      why: clip(area.why, 300),
      basedOn: refs(area.basedOn),
      taskIds: [...new Set((area.taskIds ?? []).filter((id) => tasks.has(id)))],
    }))
    // An area needs words and something it is based on: a suggestion that points at nothing cannot be checked.
    .filter((area) => area.title && area.why && area.basedOn.length > 0)
    .slice(0, LIMITS.focusAreas);

  const seen = new Set<string>();
  const carryForward: ReviewSuggestions["carryForward"] = [];
  for (const row of raw.carryForward) {
    if (!carriable.has(row.taskId) || seen.has(row.taskId)) continue;
    let newDueDate: string | null = null;
    if (row.action === "RESCHEDULE") {
      const resolved = resolveDuePhrase(row.newDueDate, today);
      // A new date has to be today or later, or the row means nothing.
      if (!resolved || resolved < today) continue;
      newDueDate = resolved;
    }
    const reason = clip(row.reason, 160);
    if (!reason) continue;
    seen.add(row.taskId);
    carryForward.push({
      taskId: row.taskId,
      title: tasks.get(row.taskId)!,
      action: row.action,
      newDueDate,
      reason,
    });
    if (carryForward.length === LIMITS.carryForward) break;
  }

  const watchouts = raw.watchouts
    .map((w) => clip(w, 200))
    .filter(Boolean)
    .slice(0, LIMITS.watchouts);
  const summary = clip(raw.summary, LIMITS.summaryChars);

  if (!summary && focusAreas.length === 0 && carryForward.length === 0 && watchouts.length === 0) {
    return null;
  }
  return { summary, focusAreas, carryForward, watchouts };
}
