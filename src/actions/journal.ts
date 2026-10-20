"use server";

import * as mutations from "@/db/mutations/journal";
import { getJournalTarget, listJournalEntries } from "@/db/queries/journal";
import { runAction, type ActionResult } from "@/lib/actions";
import { getUserToday } from "@/lib/dates/today";
import type { JournalEntryRow, JournalTarget } from "@/lib/journal/dto";
import { getDayPrefs } from "@/lib/preferences";
import { requireUser } from "@/lib/session";
import { createJournalEntrySchema, loadMoreEntriesSchema } from "@/lib/validations/journal";

// Server Actions of the journal (V3 feature 02 §4). Everything else about an entry (saving, title, tags, project,
// archive, Trash) is the note's own action. Nothing here takes a date: the server works out the person's today.

/**
 * Creates today's entry, or says which one already exists (two tabs, or another device). No revalidation: the
 * editor keeps running while the address changes to the new entry, as it does for `createNote`.
 */
export async function createJournalEntry(
  input: unknown,
): Promise<ActionResult<mutations.CreateEntryResult>> {
  return runAction("journal.create", async () => {
    const user = await requireUser();
    const parsed = createJournalEntrySchema.parse(input);
    const date = getUserToday(await getDayPrefs(user.id));
    return mutations.createJournalEntry(user.id, date, parsed);
  });
}

/** Today's entry (if any) and how many things were completed today, for the add button and the Today row. */
export async function getTodayJournalTarget(): Promise<ActionResult<JournalTarget>> {
  return runAction("journal.target", async () => {
    const user = await requireUser();
    return getJournalTarget(user.id, await getDayPrefs(user.id));
  });
}

/** The next page of the Journal list: 30 entries older than `before`, newest first. */
export async function loadMoreJournalEntries(
  input: unknown,
): Promise<ActionResult<{ items: JournalEntryRow[]; next: string | null }>> {
  return runAction("journal.list", async () => {
    const user = await requireUser();
    const { before } = loadMoreEntriesSchema.parse(input);
    return listJournalEntries(user.id, await getDayPrefs(user.id), { before });
  });
}
