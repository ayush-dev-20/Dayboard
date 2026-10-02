// Shared names for the AI layer. Safe to import from client code: no secrets, no server-only.

export const AI_FEATURES = [
  "EXTRACT_TASKS",
  "SUBTASKS",
  "SUMMARIZE_NOTE",
  "ACTION_ITEMS",
  "ASK",
  "DAILY",
  "OVERDUE_CLEANUP",
  "TASK_ASSIST",
  "CLASSIFY_INBOX",
] as const;
export type AIFeature = (typeof AI_FEATURES)[number];

/** `main` is the default model; `fast` is the cheaper one for short, simple jobs. */
export type ModelTier = "main" | "fast";

export type TokenUsage = { inputTokens?: number; outputTokens?: number };

export const TASK_ASSIST_MODES = [
  "REWRITE_DESCRIPTION",
  "CLARIFY",
  "ESTIMATE",
  "NEXT_STEPS",
] as const;
export type TaskAssistMode = (typeof TASK_ASSIST_MODES)[number];

/** Events on the streamed routes (summarize and ask), one JSON object per line. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "sources"; sources: AskSource[]; quotes: string[] }
  | { type: "error"; message: string; code: string }
  | { type: "done" };

export type AskSource = {
  /** "S1" … "S12", as cited in the answer text. */
  label: string;
  type: "task" | "todo" | "note" | "project" | "tag";
  id: string;
  title: string;
  href: string;
};

export const NOTHING_FOUND_TEXT = "I couldn't find anything about that in your workspace.";
