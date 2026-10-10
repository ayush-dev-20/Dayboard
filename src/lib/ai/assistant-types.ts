// Shared names for the workspace assistant (V2 feature 11). Safe to import from client code: no
// secrets and no server-only code.

import type { AskSource } from "./types";

/** What the assistant can be pointed at, by dropping it on the chat button or from a menu (§6A). */
export const CONTEXT_TYPES = ["note", "task", "project"] as const;
export type ContextType = (typeof CONTEXT_TYPES)[number];
export type ContextRef = { type: ContextType; id: string };
/** A chip in the chat: the reference plus the title to show. The server only ever trusts the ref. */
export type ContextChip = ContextRef & { title: string };

export const MAX_CONTEXTS = 5;
export const MAX_HISTORY = 10;
export const MESSAGE_MAX = 4000;
export const MAX_TOOL_STEPS = 5;

/** Why an item is among the sources: facts the server recorded, shown under "Why" (§4). */
export type SourceReasons = {
  via: "keyword" | "opened" | "listed" | "related" | "scope";
  /** Words from the question that the item contained. */
  matchedTerms: string[];
  /** The best matching passage (a short excerpt), when there is one. */
  passage: string | null;
};

export type AssistantSource = AskSource & { reasons: SourceReasons };

export const TOOL_NAMES = [
  "searchWorkspace",
  "getItem",
  "listTasks",
  "findRelated",
  "proposeTaskChanges",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

/** The same, while the tool is running. */
export const TOOL_PROGRESS: Record<ToolName, string> = {
  searchWorkspace: "Searching your workspace…",
  getItem: "Reading an item…",
  listTasks: "Looking through your tasks…",
  findRelated: "Looking for related items…",
  proposeTaskChanges: "Preparing a suggestion…",
};

/** The words shown while a tool runs. Plain and quiet: no "thinking", no sparkle. */
export const TOOL_LABELS: Record<ToolName, string> = {
  searchWorkspace: "Searched your workspace",
  getItem: "Read an item",
  listTasks: "Looked through your tasks",
  findRelated: "Looked for related items",
  proposeTaskChanges: "Prepared a suggestion",
};

export type TaskPriority = "NONE" | "LOW" | "MEDIUM" | "HIGH";
export type TaskStatusName = "INBOX" | "PLANNED" | "IN_PROGRESS" | "WAITING" | "DONE" | "CANCELLED";

/** A task to create. Titles and ids are validated by the server before the proposal is shown. */
export type CreateRow = {
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  projectId: string | null;
  /** Shown beside the row; looked up by the server from `projectId`. */
  projectName: string | null;
  linkNoteId: string | null;
  linkNoteTitle: string | null;
};

export type TaskFields = {
  status?: TaskStatusName;
  priority?: TaskPriority;
  dueDate?: string | null;
  projectId?: string | null;
};

/** One change to an existing task, with what it is now so the card can show before → after. */
export type UpdateRow = {
  taskId: string;
  title: string;
  set: TaskFields;
  before: {
    status: TaskStatusName;
    priority: TaskPriority;
    dueDate: string | null;
    projectName: string | null;
  };
  /** The name of the project the task would move to (looked up by the server). */
  projectName: string | null;
};

export type LinkRow = { taskId: string; taskTitle: string; noteId: string; noteTitle: string };

export type Proposal =
  | { id: string; kind: "createTasks"; items: CreateRow[] }
  | { id: string; kind: "updateTasks"; changes: UpdateRow[] }
  | { id: string; kind: "linkNotes"; links: LinkRow[] };

export type ProposalKind = Proposal["kind"];

/** A message the client sends with each turn (the last ten, trimmed). */
export type ChatTurnMessage = { role: "user" | "assistant"; text: string };
