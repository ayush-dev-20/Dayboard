import type { ProjectRef } from "../projects/dto";
import type { TaskStatus } from "../tasks/status";
import type { Snippet } from "./snippet";

export const SEARCH_TYPES = ["task", "todo", "note", "canvas", "project", "tag"] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

/** The tabs on the Search page. Tags only appear under All. */
export const SEARCH_TABS = ["all", "task", "todo", "note", "canvas", "project"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];

export const TYPE_LABELS: Record<SearchType, string> = {
  task: "Task",
  todo: "Todo",
  note: "Note",
  canvas: "Canvas",
  project: "Project",
  tag: "Tag",
};

/** Why a result was found. Built by the server from facts, never written by a model (feature 10 §5). */
export type SearchReasons = {
  /** Words and phrases from the search that the item matched. */
  terms: string[];
  /** For a meaning match: the passage that was closest, as last indexed. */
  passage: string | null;
  /** The search had a quoted phrase and the item contains it. */
  phrase: boolean;
};

export type MatchKind = "keyword" | "semantic" | "both";

export type SearchHit = {
  /** How it was found. Plain keyword search is always `keyword`. */
  matchKind: MatchKind;
  reasons: SearchReasons | null;
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
  /** A journal entry's day, "YYYY-MM-DD" (V3 feature 02). The hit is a note labelled Journal that opens in the Journal. */
  journalDate: string | null;
  /** A sticky note's board (V3 feature 01 §13). The hit is a task labelled Sticky note that opens its board. */
  stickyBoardId: string | null;
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
