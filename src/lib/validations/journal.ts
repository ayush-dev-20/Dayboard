import { z } from "zod";
import { richTextSchema } from "@/lib/editor/schema";
import { isValidDateString } from "@/lib/dates/calendar";
import { noteTitleSchema } from "./notes";

// Input of the journal actions (V3 feature 02 §4). Strict, and with no date: the server decides which day it is,
// so a client-sent `date`, `journalDate`, `userId` or `parentNoteId` is refused. The text may not hold sub-note
// blocks (`richTextSchema`).
export const createJournalEntrySchema = z.strictObject({
  title: noteTitleSchema.optional(),
  contentJson: richTextSchema.optional(),
});

export type CreateJournalEntryInput = z.infer<typeof createJournalEntrySchema>;

/** A page of the list continues after the date of the last row it showed. */
export const loadMoreEntriesSchema = z.strictObject({
  before: z.string().refine(isValidDateString, "Not a date."),
});
