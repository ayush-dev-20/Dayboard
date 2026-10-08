export const TRASH_TYPES = ["task", "todo", "note", "project", "inbox"] as const;
export type TrashType = (typeof TRASH_TYPES)[number];

export const TRASH_LABELS: Record<TrashType, string> = {
  task: "Task",
  todo: "Todo",
  note: "Note",
  project: "Project",
  inbox: "Inbox",
};

export type TrashItemDTO = {
  type: TrashType;
  id: string;
  title: string;
  emoji: string | null;
  deletedAt: string;
  /** Notes only: how many sub-notes went to Trash with this one ("Includes 3 sub-notes"). */
  subNotes: number;
  /** Notes only: everything below it in any state, which permanent deletion also removes. */
  descendants: number;
};

export type TrashCounts = Record<TrashType, number> & { total: number };

export const TRASH_PAGE = 50;

/** Where "Open" leads after a restore. */
export function trashHref(type: TrashType, id: string): string {
  switch (type) {
    case "task":
      return `/tasks?task=${id}`;
    case "todo":
      return "/tasks?view=todos";
    case "note":
      return `/notes/${id}`;
    case "project":
      return `/projects/${id}`;
    case "inbox":
      return "/inbox";
  }
}

/** "6 items will be deleted permanently: 2 tasks, 1 todo, 1 note, 1 project and 1 inbox item." */
export function describeCounts(counts: Omit<TrashCounts, "total">): string {
  const noun: Record<TrashType, [string, string]> = {
    task: ["task", "tasks"],
    todo: ["todo", "todos"],
    note: ["note", "notes"],
    project: ["project", "projects"],
    inbox: ["inbox item", "inbox items"],
  };
  const parts = TRASH_TYPES.filter((t) => counts[t] > 0).map(
    (t) => `${counts[t]} ${noun[t][counts[t] === 1 ? 0 : 1]}`,
  );
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
