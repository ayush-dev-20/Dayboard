// Limits and small vocabularies for the editor's structural blocks (V2 feature 01). Shared by the
// document validator (server and client), the editor's own guards and the UI messages.

/** A table is at most this many columns and rows. */
export const TABLE_MAX_COLUMNS = 10;
export const TABLE_MAX_ROWS = 100;

/** Lists nest this many levels (bullets and numbers). */
export const LIST_MAX_DEPTH = 6;

export const CALLOUT_TONES = ["neutral", "info", "success", "warning"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];
export const DEFAULT_CALLOUT_EMOJI = "💡";

/** 0 is a plain toggle; 1 to 3 make its summary a heading. */
export const TOGGLE_LEVELS = [0, 1, 2, 3] as const;

export const MESSAGES = {
  tableColumns: `Tables can have up to ${TABLE_MAX_COLUMNS} columns.`,
  tableRows: `Tables can have up to ${TABLE_MAX_ROWS} rows.`,
  listDepth: "Lists can go six levels deep.",
} as const;
