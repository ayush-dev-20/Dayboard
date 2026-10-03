// The getting-started checklist (feature 07 §9.6). Every item is derived from what the person
// already has, so nothing is ticked by hand and nothing can drift out of date.

export type ChecklistCounts = {
  /** Inbox items ever captured (open, converted or archived; not deleted). */
  inbox: number;
  tasks: number;
  notes: number;
  /** Task–note links. */
  links: number;
};

export type ChecklistItem = {
  key: "capture" | "task" | "note" | "link";
  label: string;
  /** Where to go to do it. */
  href: string;
  done: boolean;
};

export type Checklist = { items: ChecklistItem[]; done: number; complete: boolean };

export function deriveChecklist(counts: ChecklistCounts): Checklist {
  const items: ChecklistItem[] = [
    { key: "capture", label: "Capture a thought", href: "/inbox", done: counts.inbox > 0 },
    { key: "task", label: "Add a task", href: "/tasks?focus=add", done: counts.tasks > 0 },
    { key: "note", label: "Write a note", href: "/notes/new", done: counts.notes > 0 },
    { key: "link", label: "Link a note to a task", href: "/tasks", done: counts.links > 0 },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, complete: done === items.length };
}
