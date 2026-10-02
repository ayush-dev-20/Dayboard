// The note editor's save lifecycle as a small state machine, kept apart from React so its rules
// can be tested: idle -> saving -> saved | conflict | failed -> (retry) saving.

export type NoteSaveState =
  | { phase: "idle" }
  /** `attempts` is set while a retry after a failure is in flight. */
  | { phase: "saving"; attempts?: number }
  | { phase: "saved" }
  | { phase: "failed"; attempts: number }
  | { phase: "conflict" };

export type NoteSaveEvent =
  | { type: "edit" }
  | { type: "start" }
  | { type: "succeeded" }
  | { type: "failed" }
  | { type: "conflicted" }
  | { type: "resolved" } // the person chose Load latest or Keep mine
  | { type: "fade" }; // "Saved" has been visible long enough

export const INITIAL_SAVE_STATE: NoteSaveState = { phase: "idle" };

export function noteSaveReducer(state: NoteSaveState, event: NoteSaveEvent): NoteSaveState {
  switch (event.type) {
    case "edit":
      // A conflict stays until the person decides; failed keeps counting retries.
      return state.phase === "conflict" || state.phase === "failed" ? state : { phase: "idle" };
    case "start":
      if (state.phase === "conflict") return state;
      return state.phase === "failed"
        ? { phase: "saving", attempts: state.attempts }
        : { phase: "saving" };
    case "succeeded":
      return state.phase === "conflict" ? state : { phase: "saved" };
    case "failed": {
      const before =
        state.phase === "failed" || state.phase === "saving" ? (state.attempts ?? 0) : 0;
      return { phase: "failed", attempts: before + 1 };
    }
    case "conflicted":
      return { phase: "conflict" };
    case "resolved":
      return { phase: "idle" };
    case "fade":
      return state.phase === "saved" ? { phase: "idle" } : state;
  }
}

/** 2s, 4s, 8s, 16s, then 30s at most (feature doc §4). */
export function retryDelayMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt - 1), 30_000);
}

/** The status line text, or null when there is nothing to say. */
export function saveLabel(state: NoteSaveState): string | null {
  switch (state.phase) {
    case "saving":
      return "Saving…";
    case "saved":
      return "Saved";
    case "failed":
      return "Not saved, retrying";
    default:
      return null;
  }
}
