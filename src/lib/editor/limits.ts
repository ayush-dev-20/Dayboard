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
  // V2 feature 02: pasted content that had to be trimmed.
  tableCut: `Table was cut to ${TABLE_MAX_COLUMNS} columns and ${TABLE_MAX_ROWS} rows.`,
  pasteShortened: "Pasted content was shortened to fit.",
} as const;

// Files and bookmarks (V2 feature 09 §2).
export const IMAGE_CAPTION_MAX = 500;
/** A picture is never shown narrower, or shorter, than this many pixels (feature 09 §6, Resizing). */
export const IMAGE_MIN_SIZE = 64;
export const IMAGE_WIDTH_MIN = IMAGE_MIN_SIZE;
/** The widest `width` a document may hold; a narrower column simply shows the picture smaller. */
export const IMAGE_WIDTH_MAX = 4000;
export const BOOKMARK_TITLE_MAX = 200;
export const BOOKMARK_DESCRIPTION_MAX = 400;
export const BOOKMARK_SITE_MAX = 100;
/** A stored favicon is a small data: URI (8 KB of image is about 11,000 characters of base64). */
export const BOOKMARK_FAVICON_MAX_CHARS = 12_000;
