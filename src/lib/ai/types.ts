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
  "GENERATE_CONTENT",
  "PLAN_DAY",
  "EDIT_SELECTION",
  // V2 feature 11.
  "ASSISTANT",
  "ASK_SELECTION",
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

export const GENERATE_LENGTHS = ["SHORT", "STANDARD", "DETAILED"] as const;
export type GenerateLength = (typeof GENERATE_LENGTHS)[number];

// `CUSTOM` is "Update with AI" (V2 feature 11 §6B): the person writes the instruction.
export const EDIT_MODES = ["IMPROVE", "SHORTEN", "FIX_GRAMMAR", "CONTINUE", "CUSTOM"] as const;
export type EditMode = (typeof EDIT_MODES)[number];

/** One task in a streamed day plan. Everything but `reason` comes from our own data, not the model. */
export type PlanProposal = {
  taskId: string;
  title: string;
  emoji: string | null;
  /** "YYYY-MM-DD" or null. */
  dueDate: string | null;
  priority: "NONE" | "LOW" | "MEDIUM" | "HIGH";
  project: string | null;
  reason: string;
};

/** Events on the streamed routes, one JSON object per line. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "sources"; sources: AskSource[]; quotes: string[] }
  /** Generate: the suggested note title, sent once, before the body. */
  | { type: "title"; text: string }
  /** Plan my day: the one-sentence summary, then one proposal per valid task. */
  | { type: "summary"; text: string }
  | { type: "proposal"; item: PlanProposal }
  /** The assistant is using a tool: a quiet "Searching your workspace…" line (feature 11 §4). */
  | { type: "tool"; name: string; status: "start" | "done" }
  /** The assistant proposes changes. Nothing is written until the person confirms (feature 11 §5). */
  | { type: "assistant-proposal"; proposal: import("./assistant-types").Proposal }
  | { type: "error"; message: string; code: string }
  | { type: "done" };

export type AskSource = {
  /** "S1" … "S12", as cited in the answer text. */
  label: string;
  type: "task" | "todo" | "note" | "project" | "tag";
  id: string;
  title: string;
  href: string;
  /**
   * Why the assistant had this item (feature 11 §4): recorded by the server from the search and the
   * tools, never written by the model.
   */
  reasons?: import("./assistant-types").SourceReasons;
};

export const NOTHING_FOUND_TEXT = "I couldn't find anything about that in your workspace.";
