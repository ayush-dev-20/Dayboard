import type { ProjectRef } from "../projects/dto";
import type { TaskStatus } from "../tasks/status";
import type { Snippet } from "./snippet";

export const SEARCH_TYPES = ["task", "todo", "note", "project", "tag"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** The tabs on the Search page. Tags only appear under All. */
export const SEARCH_TABS = ["all", "task", "todo", "note", "project"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export const TYPE_LABELS: Record<SearchType, string> = {
  task: "Task",
  todo: "Todo",
  note: "Note",
  project: "Project",
  tag: "Tag",
};

export type SearchHit = {
  type: SearchType;
  id: string;
  title: string;
  emoji: string | null;
  href: string;
  archived: boolean;
  project: ProjectRef | null;
  /** The matching text around the first body match, as plain segments. */
  snippet: Snippet | null;
  /** Notes: the titles of the notes it sits under, top-level first (V2 feature 07). */
  path: string[];
  status: TaskStatus | null;
  /** Tasks and todos. */
  dueDate: string | null;
  done: boolean;
  /** Tags: how many tasks and notes use it. */
  taskCount: number;
  noteCount: number;
  updatedAt: string;
};

export type SearchResults = Record<SearchType, SearchHit[]> & { total: number };

export type SearchParams = {
  q: string;
  tab: SearchTab;
  status: TaskStatus | null;
  /** A project id, "none", or null for any. */
  projectId: string | null;
  tagId: string | null;
  /** "YYYY-MM-DD", inclusive. Due date for tasks and todos, last update for notes and projects. */
  from: string | null;
  to: string | null;
};
