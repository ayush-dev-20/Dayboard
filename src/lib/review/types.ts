// Shared shapes for the weekly review (V2 feature 15). Safe to import from client code: no secrets, no
// server-only. Facts and suggestions are kept apart on purpose: facts are computed from the person's own data and
// never touched by a model; suggestions are validated AI output.

export const FACT_KEYS = [
  "completed",
  "overdue",
  "notes",
  "projects",
  "calendar",
  "postponements",
  "inbox",
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export const FACTS_VERSION = 1;

/** Facts only ever list this many items; the rest is a count. */
export const LIMITS = {
  completedTitles: 10,
  overdueItems: 10,
  noteTitles: 8,
  carryForward: 8,
  focusAreas: 3,
  watchouts: 3,
  summaryChars: 400,
} as const;

export type ProjectCount = { projectId: string | null; name: string | null; count: number };

export type ReviewFacts = {
  version: typeof FACTS_VERSION;
  weekStart: string;
  weekEnd: string;
  /** The day the counts of "late" were measured on: today, or the last day of the week for a finished week. */
  asOf: string;
  computedAt: string;
  completed: {
    tasks: number;
    todos: number;
    byProject: ProjectCount[];
    /** Most recently completed first. */
    recent: { type: "task" | "todo"; id: string; title: string; completedAt: string }[];
  };
  overdue: {
    /** Open tasks due on or before the end of the week. */
    count: number;
    /** Of those, due during this week (the rest were late before it began). */
    carriedForward: number;
    /** The oldest first. */
    items: {
      id: string;
      title: string;
      dueDate: string;
      daysLate: number;
      carried: boolean;
      projectId: string | null;
    }[];
  };
  notes: {
    created: number;
    edited: number;
    titles: { id: string; title: string }[];
  };
  projects: {
    active: {
      id: string;
      name: string;
      completed: number;
      tasksCreated: number;
      notesCreated: number;
    }[];
    quiet: { id: string; name: string }[];
  };
  /** Null when no calendar is connected: never estimated. */
  calendar: null | {
    days: { date: string; hours: number }[];
    busiest: { date: string; hours: number } | null;
    totalHours: number;
  };
  postponements: {
    /** False when less than two weeks of schedule history exist. */
    enough: boolean;
    items: { taskId: string; title: string; count: number }[];
  };
  inbox: { captured: number; processed: number };
};

export type FactRef = { fact: FactKey; ids: string[] };

export const CARRY_ACTIONS = ["KEEP", "RESCHEDULE", "DROP"] as const;
export type CarryAction = (typeof CARRY_ACTIONS)[number];

export type ReviewSuggestions = {
  summary: string;
  focusAreas: { title: string; why: string; basedOn: FactRef[]; taskIds: string[] }[];
  carryForward: {
    taskId: string;
    title: string;
    action: CarryAction;
    newDueDate: string | null;
    reason: string;
  }[];
  watchouts: string[];
};

export type SuggestionsState = "NONE" | "GENERATED" | "UNAVAILABLE" | "OFF";

/** Why a review has no suggestions, as a plain code. */
export type SuggestionsError = "AI_OFF" | "RATE_LIMITED" | "AI_PROVIDER_ERROR" | "EMPTY" | null;

export type ReviewDTO = {
  id: string;
  weekStart: string;
  weekEnd: string;
  status: "PENDING" | "READY" | "FAILED";
  partial: boolean;
  facts: ReviewFacts | null;
  suggestions: ReviewSuggestions | null;
  suggestionsStatus: SuggestionsState;
  suggestionsError: SuggestionsError;
  /** Whether "Regenerate suggestions" is allowed now (once a day). */
  canRegenerate: boolean;
  carryApplied: boolean;
  generatedAt: string | null;
  viewedAt: string | null;
  dismissedAt: string | null;
};

export type ReviewListItem = {
  id: string;
  weekStart: string;
  weekEnd: string;
  partial: boolean;
};

/** What one applied row replaced, so Undo can put it back. */
export type CarryUndo = {
  taskId: string;
  dueDate: string | null;
  status: string;
  archived: boolean;
};
