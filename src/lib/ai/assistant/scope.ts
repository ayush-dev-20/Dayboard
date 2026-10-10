import type { ContextRef, ContextType } from "../assistant-types";

// What the tools may see when the person pointed the assistant at specific items (feature 11 §4,
// "Several items"). With no scope the whole workspace is open (to the owner, as always). Pure.

export type Scope = {
  note: ReadonlySet<string>;
  task: ReadonlySet<string>;
  project: ReadonlySet<string>;
};

export function buildScope(
  refs: ContextRef[],
  members: { tasks: string[]; notes: string[] },
): Scope {
  const note = new Set<string>(members.notes);
  const task = new Set<string>(members.tasks);
  const project = new Set<string>();
  for (const ref of refs) {
    if (ref.type === "note") note.add(ref.id);
    else if (ref.type === "task") task.add(ref.id);
    else project.add(ref.id);
  }
  return { note, task, project };
}

/** True when there is no scope (everything of the owner's) or the item is inside it. */
export function inScope(scope: Scope | null, type: string, id: string): boolean {
  if (!scope) return true;
  if (type === "note" || type === "task" || type === "project") {
    return scope[type as ContextType].has(id);
  }
  // Todos and tags are not something a person can point the assistant at.
  return false;
}

/** Removes duplicates, keeps the order, and refuses more than `max` items. */
export function dedupeRefs(refs: ContextRef[], max: number): ContextRef[] | null {
  const seen = new Set<string>();
  const out: ContextRef[] = [];
  for (const ref of refs) {
    const key = `${ref.type}:${ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out.length > max ? null : out;
}
