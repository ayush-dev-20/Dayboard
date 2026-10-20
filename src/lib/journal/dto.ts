import type { ProjectRef } from "../projects/dto";

// What the journal sends to the page (V3 feature 02 §4). Dates are "YYYY-MM-DD", the person's own day.

/** A row of the Journal list. */
export type JournalEntryRow = {
  id: string;
  date: string;
  title: string;
  /** The first stretch of the text, on one line. */
  firstLine: string;
  emoji: string | null;
  archived: boolean;
  doneCount: number;
};

/** A row of the sidebar section: the short date and a tooltip. */
export type JournalSidebarEntry = { id: string; date: string; firstLine: string };

/** What the add button, the Today row and the sidebar need to know about today. */
export type JournalTarget = {
  date: string;
  /** The live entry for that day, if one exists (archived included). */
  entryId: string | null;
  archived: boolean;
  /** Tasks and todos completed so far on that day. */
  doneCount: number;
};

/** A task or todo that was completed on the day. */
export type DoneItem = {
  type: "task" | "todo";
  id: string;
  title: string;
  emoji: string | null;
  project: ProjectRef | null;
  /** ISO instant. The page shows the time in the person's own zone. */
  completedAt: string;
  /** For a sub-task: the title of the task it belongs to. */
  parentTitle: string | null;
  /** A todo's due date, so editing it from the list keeps it. */
  dueDate: string | null;
};

export type DoneOnDay = {
  /** At most `DONE_LIMIT`, in the order they were completed. */
  items: DoneItem[];
  /** How many were completed in all, so the list can say "and N more". */
  total: number;
};

export const DONE_LIMIT = 200;
export const JOURNAL_PAGE = 30;
/** How many entries the sidebar section lists. */
export const SIDEBAR_ENTRIES = 5;
