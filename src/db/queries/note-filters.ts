import { isNotNull, isNull } from "drizzle-orm";
import { notes } from "@/db/schema";

// Journal entries are notes that carry a date (V3 feature 02 §3). The Notes collection (its list, the sidebar
// tree, views, the Move-to picker, counts) leaves them out through `plainNotes`; everything that reaches a note
// by relationship or by search (search, Trash, links, backlinks, the assistant) includes them. The choice for
// every query that reads `notes` is written down in `src/lib/notes/query-classes.ts`, and a test fails when one
// is missing.

/** Ordinary notes only: not a journal entry. */
export const plainNotes = isNull(notes.journalDate);

/** Journal entries only. */
export const journalEntries = isNotNull(notes.journalDate);
