import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createJournalEntry, getTodayJournalTarget } from "@/actions/journal";
import {
  archiveNote,
  createNote,
  createSubNote,
  deleteNote,
  moveNote,
  permanentlyDeleteNote,
  restoreNote,
  saveNoteContent,
  saveNoteTitle,
  updateNoteMeta,
} from "@/actions/notes";
import { createJournalEntry as createEntryRow } from "@/db/mutations/journal";
import { completeTask } from "@/db/mutations/tasks";
import { db } from "@/db/client";
import {
  getBacklinks,
  getNoteTree,
  getOutline,
  searchNotesForNoteLink,
} from "@/db/queries/note-tree";
import {
  countDoneByDay,
  getDoneOnDay,
  getJournalEntry,
  getJournalTarget,
  listJournalEntries,
  listSidebarEntries,
} from "@/db/queries/journal";
import { countNotes, getNote, listNotes } from "@/db/queries/notes";
import { searchWorkspace } from "@/db/queries/search";
import { listTrash } from "@/db/queries/trash";
import { listNotesForViews } from "@/db/queries/views";
import { checklistCounts } from "@/db/queries/onboarding";
import { notes, tasks, todos } from "@/db/schema";
import { addDays } from "@/lib/dates/calendar";
import { journalTitle } from "@/lib/dates/journal";
import { getUserToday } from "@/lib/dates/today";
import { DONE_LIMIT } from "@/lib/journal/dto";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 02 against a real database: one entry per day (also at the same moment), ownership on every route,
// entries left out of the Notes collection and found everywhere else, Trash and restore, and "Done on this day".

const PREFS = { timezone: "UTC", startOfDay: "06:00" };
const TODAY = () => getUserToday(PREFS);
const GONE = "00000000-0000-4000-8000-000000000000";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-journal");
  bob = await createTestUser("bob-journal");
});

const doc = (...texts: string[]) => ({
  type: "doc" as const,
  content: texts.map((t) => ({ type: "paragraph", content: [{ type: "text", text: t }] })),
});

/** An entry for a given day, written straight to the table (the action only ever makes today's). */
async function entryFor(who: TestUser, date: string, title = journalTitle(date), text = "") {
  const created = await createEntryRow(who.id, date, {
    title,
    contentJson: text ? doc(text) : undefined,
  });
  if (created.outcome !== "created") throw new Error("expected a new entry");
  return created.id;
}

async function task(who: TestUser, title: string, over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(tasks)
    .values({ userId: who.id, title, sortOrder: 0, ...over })
    .returning({ id: tasks.id });
  return row!.id;
}
async function todo(who: TestUser, title: string, over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(todos)
    .values({ userId: who.id, title, sortOrder: 0, ...over })
    .returning({ id: todos.id });
  return row!.id;
}
const at = (date: string, time: string) => new Date(`${date}T${time}:00.000Z`);
const done = (completedAt: Date) => ({ status: "DONE" as const, completedAt });

describe("createJournalEntry", () => {
  it("creates today's entry with the date as its title, and a second call finds it", async () => {
    const who = await createTestUser("create-entry");
    actAs(who);
    const first = ok(await createJournalEntry({}));
    expect(first).toMatchObject({ outcome: "created", date: TODAY() });
    const row = (await db.select().from(notes).where(eq(notes.userId, who.id)))[0]!;
    expect(row.journalDate).toBe(TODAY());
    expect(row.title).toBe(journalTitle(TODAY()));
    expect(row.parentNoteId).toBeNull();
    expect(row.depth).toBe(1);

    const second = ok(await createJournalEntry({ contentJson: doc("again") }));
    expect(second).toMatchObject({ outcome: "exists", id: first.id });
    expect(await db.select().from(notes).where(eq(notes.userId, who.id))).toHaveLength(1);
  });

  it("two calls at the same moment make one entry", async () => {
    const who = await createTestUser("race-entry");
    actAs(who);
    const results = await Promise.all([1, 2, 3, 4].map(() => createJournalEntry({})));
    const outcomes = results.map((r) => ok(r).outcome).sort();
    expect(outcomes).toEqual(["created", "exists", "exists", "exists"]);
    const rows = await db.select().from(notes).where(eq(notes.userId, who.id));
    expect(rows).toHaveLength(1);
  });

  it("checks the text, builds the text copy on the server and keeps a typed title", async () => {
    const who = await createTestUser("sanitise-entry");
    actAs(who);
    const made = ok(
      await createJournalEntry({ title: "  My   day ", contentJson: doc("Hello journal") }),
    );
    const row = (await db.select().from(notes).where(eq(notes.id, made.id)))[0]!;
    expect(row.title).toBe("My day");
    expect(row.contentText).toContain("Hello journal");
  });

  it("refuses a date, a parent, a user id or a text copy from the client", async () => {
    const who = await createTestUser("strict-entry");
    actAs(who);
    for (const extra of [
      { date: "2020-01-01" },
      { journalDate: "2020-01-01" },
      { parentNoteId: GONE },
      { userId: bob.id },
      { contentText: "forged" },
    ]) {
      expect(errorOf(await createJournalEntry(extra)).code).toBe("VALIDATION_ERROR");
    }
    expect(await db.select().from(notes).where(eq(notes.userId, who.id))).toHaveLength(0);
  });

  it("refuses sub-note blocks in the text", async () => {
    const who = await createTestUser("subnote-entry");
    actAs(who);
    const block = { type: "doc", content: [{ type: "subNote", attrs: { noteId: GONE } }] };
    expect(errorOf(await createJournalEntry({ contentJson: block })).code).toBe("VALIDATION_ERROR");
  });

  it("is UNAUTHENTICATED when signed out", async () => {
    actAs(null);
    expect(errorOf(await createJournalEntry({})).code).toBe("UNAUTHENTICATED");
    expect(errorOf(await getTodayJournalTarget()).code).toBe("UNAUTHENTICATED");
  });

  it("follows the person's own day: another time zone can be a different date", async () => {
    const who = await createTestUser("zone-entry");
    // Two zones 25 hours apart are always on different days.
    const east = getUserToday({ timezone: "Pacific/Kiritimati", startOfDay: "06:00" });
    const west = getUserToday({ timezone: "Pacific/Pago_Pago", startOfDay: "06:00" });
    expect(east).not.toBe(west);
    const a = await createEntryRow(who.id, east, {});
    const b = await createEntryRow(who.id, west, {});
    expect([a.outcome, b.outcome]).toEqual(["created", "created"]);
  });
});

describe("ownership", () => {
  it("another person's entry is NOT_FOUND by every route, and signed out is UNAUTHENTICATED", async () => {
    const id = await entryFor(alice, TODAY());
    actAs(bob);
    expect(await getJournalEntry(bob.id, id)).toBeNull();
    expect(await getNote(bob.id, id)).toBeNull();
    for (const result of [
      await saveNoteTitle({ id, title: "x", baseVersion: 1 }),
      await saveNoteContent({ id, contentJson: doc("x"), baseVersion: 1 }),
      await updateNoteMeta({ id, emoji: "📔" }),
      await archiveNote({ id, archived: true }),
      await deleteNote({ id }),
      await restoreNote({ id }),
      await permanentlyDeleteNote({ id }),
    ]) {
      expect(errorOf(result).code).toBe("NOT_FOUND");
    }
    expect((await getJournalTarget(bob.id, PREFS)).entryId).toBeNull();
    actAs(null);
    expect(errorOf(await deleteNote({ id })).code).toBe("UNAUTHENTICATED");
    // Alice's entry is untouched.
    expect((await db.select().from(notes).where(eq(notes.id, id)))[0]!.deletedAt).toBeNull();
  });

  it("a person's list, sidebar and Done never include another person's entries", async () => {
    const carol = await createTestUser("carol-journal");
    await entryFor(carol, TODAY(), journalTitle(TODAY()), "secret carol");
    await task(carol, "Carol's task", done(at(TODAY(), "12:00")));
    expect(
      (await listJournalEntries(bob.id, PREFS)).items.some((e) => e.firstLine.includes("carol")),
    ).toBe(false);
    expect((await listSidebarEntries(bob.id)).some((e) => e.firstLine.includes("carol"))).toBe(
      false,
    );
    const bobsDone = await getDoneOnDay(bob.id, TODAY(), PREFS);
    expect(bobsDone.items.some((i) => i.title === "Carol's task")).toBe(false);
  });
});

describe("what an entry may not do", () => {
  it("can be edited like a note", async () => {
    const who = await createTestUser("edit-entry");
    actAs(who);
    const id = await entryFor(who, TODAY());
    const saved = ok(await saveNoteContent({ id, contentJson: doc("Wrote this"), baseVersion: 1 }));
    expect(saved.outcome).toBe("saved");
    const renamed = ok(await saveNoteTitle({ id, title: "Renamed", baseVersion: 2 }));
    expect(renamed.outcome).toBe("saved");
    const row = (await db.select().from(notes).where(eq(notes.id, id)))[0]!;
    // A rename never moves the entry to another day.
    expect(row.journalDate).toBe(TODAY());
    expect(row.title).toBe("Renamed");
    expect(row.contentText).toContain("Wrote this");
  });

  it("holds no sub-notes and can't be moved: not as a parent, not as a child, not within the top level", async () => {
    const who = await createTestUser("structure-entry");
    actAs(who);
    const entry = await entryFor(who, TODAY());
    const plain = ok(await createNote({ title: "Plain" })).id;
    expect(errorOf(await createSubNote({ parentId: entry })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await moveNote({ id: plain, parentId: entry })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await moveNote({ id: entry, parentId: plain })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await moveNote({ id: entry, parentId: null })).code).toBe("VALIDATION_ERROR");
    const row = (await db.select().from(notes).where(eq(notes.id, entry)))[0]!;
    expect(row.parentNoteId).toBeNull();
  });

  it("no note action takes a date or a parent", async () => {
    const who = await createTestUser("fields-entry");
    actAs(who);
    const id = await entryFor(who, TODAY());
    expect(errorOf(await updateNoteMeta({ id, journalDate: "2020-01-01" })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await createNote({ journalDate: "2020-01-01" })).code).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await saveNoteTitle({ id, title: "x", baseVersion: 1, parentNoteId: GONE })).code,
    ).toBe("VALIDATION_ERROR");
    expect((await db.select().from(notes).where(eq(notes.id, id)))[0]!.journalDate).toBe(TODAY());
  });

  it("keeps a pasted sub-note block as a link", async () => {
    const who = await createTestUser("paste-entry");
    actAs(who);
    const entry = await entryFor(who, TODAY());
    const other = ok(await createNote({ title: "Other" })).id;
    const block = { type: "doc", content: [{ type: "subNote", attrs: { noteId: other } }] };
    const saved = ok(await saveNoteContent({ id: entry, contentJson: block, baseVersion: 1 }));
    expect(saved.outcome).toBe("saved");
    const stored = (await db.select().from(notes).where(eq(notes.id, entry)))[0]!;
    expect(JSON.stringify(stored.contentJson)).not.toContain('"subNote"');
    expect(JSON.stringify(stored.contentJson)).toContain(other);
  });

  it("the database refuses an entry with a parent", async () => {
    const who = await createTestUser("check-entry");
    const parent = ok((actAs(who), await createNote({ title: "P" }))).id;
    await expect(
      db.insert(notes).values({
        userId: who.id,
        parentNoteId: parent,
        depth: 2,
        journalDate: TODAY(),
        contentJson: doc(),
      }),
    ).rejects.toThrow();
  });
});

describe("entries and the Notes collection", () => {
  it("are left out of the list, the count, the sidebar tree, the outline and every view", async () => {
    const who = await createTestUser("collection-entry");
    actAs(who);
    const entry = await entryFor(who, TODAY(), "Today's pages", "daily words");
    const plain = ok(await createNote({ title: "An ordinary note" })).id;

    expect((await listNotes(who.id)).map((n) => n.id)).toEqual([plain]);
    expect(await countNotes(who.id)).toEqual({ active: 1, archived: 0 });
    const tree = await getNoteTree(who.id);
    expect(tree.rows.map((r) => r.id)).toEqual([plain]);
    expect(tree.rootTotal).toBe(1);
    expect((await getOutline(who.id)).map((r) => r.id)).toEqual([plain]);
    expect((await listNotesForViews(who.id)).map((n) => n.id)).toEqual([plain]);
    // An archived entry is not in the archived Notes either.
    ok(await archiveNote({ id: entry, archived: true }));
    expect((await listNotes(who.id, { archived: true })).map((n) => n.id)).toEqual([]);
    expect((await listNotesForViews(who.id, { archivedOnly: true })).map((n) => n.id)).toEqual([]);
    expect(await countNotes(who.id)).toEqual({ active: 1, archived: 0 });
  });

  it("do not tick the checklist's first-note step", async () => {
    const who = await createTestUser("checklist-entry");
    await entryFor(who, TODAY());
    expect((await checklistCounts(who.id)).notes).toBe(0);
  });

  it("are found by search, by a link picker and by backlinks, and open from Trash", async () => {
    const who = await createTestUser("found-entry");
    actAs(who);
    const entry = await entryFor(who, TODAY(), "Pages of the day", "kumquat marmalade");
    const hits = await searchWorkspace(
      who.id,
      {
        q: "kumquat",
        tab: "all",
        status: null,
        projectId: null,
        tagId: null,
        from: null,
        to: null,
      },
      PREFS,
      10,
    );
    expect(hits.note.map((h) => h.id)).toEqual([entry]);
    expect((await searchNotesForNoteLink(who.id, "Pages")).map((h) => h.id)).toContain(entry);

    // A note that links to the entry shows up in the entry's backlinks.
    const link = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "noteLink", attrs: { noteId: entry } }] }],
    };
    const linker = ok(await createNote({ title: "Linker", contentJson: link })).id;
    expect((await getBacklinks(who.id, entry)).map((b) => b.id)).toEqual([linker]);

    ok(await deleteNote({ id: entry }));
    const trashed = (await listTrash(who.id)).items.find((i) => i.id === entry);
    expect(trashed).toMatchObject({ type: "note", title: "Pages of the day" });
  });
});

describe("Trash, restore and the day", () => {
  it("restoring brings the entry back, and restoring onto a taken day is a CONFLICT", async () => {
    const who = await createTestUser("restore-entry");
    actAs(who);
    const first = ok(await createJournalEntry({})).id;
    ok(await deleteNote({ id: first }));
    expect((await getJournalTarget(who.id, PREFS)).entryId).toBeNull();

    // The day is free again, so a new entry can be made.
    const second = ok(await createJournalEntry({ contentJson: doc("second") }));
    expect(second.outcome).toBe("created");
    const refused = errorOf(await restoreNote({ id: first }));
    expect(refused.code).toBe("CONFLICT");
    expect(refused.message).toContain("already an entry for that day");
    // Nothing changed: the first is still in Trash, the second is live.
    expect((await db.select().from(notes).where(eq(notes.id, first)))[0]!.deletedAt).not.toBeNull();

    // Delete the second for good; the first can come back.
    ok(await deleteNote({ id: second.id }));
    ok(await permanentlyDeleteNote({ id: second.id }));
    ok(await restoreNote({ id: first }));
    expect((await getJournalTarget(who.id, PREFS)).entryId).toBe(first);
  });

  it("permanent delete frees the day", async () => {
    const who = await createTestUser("perm-entry");
    actAs(who);
    const first = ok(await createJournalEntry({})).id;
    ok(await deleteNote({ id: first }));
    ok(await permanentlyDeleteNote({ id: first }));
    expect(await db.select().from(notes).where(eq(notes.userId, who.id))).toHaveLength(0);
    expect(ok(await createJournalEntry({})).outcome).toBe("created");
  });

  it("an archived entry still holds its day and opens through today's target", async () => {
    const who = await createTestUser("archive-entry");
    actAs(who);
    const first = ok(await createJournalEntry({})).id;
    ok(await archiveNote({ id: first, archived: true }));
    const target = ok(await getTodayJournalTarget());
    expect(target).toMatchObject({ entryId: first, archived: true });
    expect(ok(await createJournalEntry({}))).toMatchObject({ outcome: "exists", id: first });
    const live = await db
      .select()
      .from(notes)
      .where(and(eq(notes.userId, who.id), isNull(notes.deletedAt)));
    expect(live).toHaveLength(1);
  });
});

describe("Journal list and sidebar", () => {
  it("lists newest day first, 30 to a page, with the first line and the done count", async () => {
    const who = await createTestUser("list-entry");
    let date = "2026-01-01";
    for (let i = 0; i < 35; i += 1) {
      await entryFor(who, date, journalTitle(date), `line ${i}`);
      date = addDays(date, 1);
    }
    await task(who, "Finished", done(at("2026-02-03", "10:00")));
    const first = await listJournalEntries(who.id, PREFS);
    expect(first.items).toHaveLength(30);
    expect(first.items[0]!.date > first.items[29]!.date).toBe(true);
    expect(first.next).toBe(first.items[29]!.date);
    const rest = await listJournalEntries(who.id, PREFS, { before: first.next });
    expect(rest.items).toHaveLength(5);
    expect(rest.next).toBeNull();
    const day = first.items.find((e) => e.date === "2026-02-03")!;
    expect(day.doneCount).toBe(1);
    expect(day.firstLine).toBe("line 33");
    expect((await listSidebarEntries(who.id)).map((e) => e.date)).toEqual([
      "2026-02-04",
      "2026-02-03",
      "2026-02-02",
      "2026-02-01",
      "2026-01-31",
    ]);
  });

  it("puts archived entries in their own list and leaves Trash out", async () => {
    const who = await createTestUser("archived-list-entry");
    actAs(who);
    const a = await entryFor(who, "2026-03-01");
    const b = await entryFor(who, "2026-03-02");
    const c = await entryFor(who, "2026-03-03");
    ok(await archiveNote({ id: b, archived: true }));
    ok(await deleteNote({ id: c }));
    expect((await listJournalEntries(who.id, PREFS)).items.map((e) => e.id)).toEqual([a]);
    expect(
      (await listJournalEntries(who.id, PREFS, { archived: true })).items.map((e) => e.id),
    ).toEqual([b]);
  });
});

describe("getDoneOnDay", () => {
  const D = "2026-06-10";

  it("lists tasks and todos completed inside the day, in the order they were done", async () => {
    const who = await createTestUser("done-basic");
    await task(who, "Task B", done(at(D, "14:05")));
    await task(who, "Task A", done(at(D, "07:00")));
    await todo(who, "Todo C", { isComplete: true, completedAt: at(D, "09:30") });
    await task(who, "Open task");
    await todo(who, "Open todo");
    const result = await getDoneOnDay(who.id, D, PREFS);
    expect(result.total).toBe(3);
    expect(result.items.map((i) => `${i.type}:${i.title}`)).toEqual([
      "task:Task A",
      "todo:Todo C",
      "task:Task B",
    ]);
  });

  it("uses the person's day: 05:59 belongs to the day before a 06:00 start", async () => {
    const who = await createTestUser("done-edges");
    await task(who, "Just before", done(at(D, "05:59")));
    await task(who, "On the dot", done(at(D, "06:00")));
    await task(who, "Last minute", done(at(addDays(D, 1), "05:59")));
    await task(who, "Next day", done(at(addDays(D, 1), "06:00")));
    const today = await getDoneOnDay(who.id, D, PREFS);
    expect(today.items.map((i) => i.title)).toEqual(["On the dot", "Last minute"]);
    const before = await getDoneOnDay(who.id, addDays(D, -1), PREFS);
    expect(before.items.map((i) => i.title)).toEqual(["Just before"]);
  });

  it("follows a time zone and a custom start of day", async () => {
    const who = await createTestUser("done-zone");
    // 2026-06-10 01:00 in Kolkata is 2026-06-09 19:30 UTC.
    await task(who, "Kolkata morning", done(new Date("2026-06-09T20:00:00.000Z")));
    const kolkata = { timezone: "Asia/Kolkata", startOfDay: "00:00" };
    expect((await getDoneOnDay(who.id, "2026-06-10", kolkata)).items).toHaveLength(1);
    expect((await getDoneOnDay(who.id, "2026-06-09", kolkata)).items).toHaveLength(0);
  });

  it("leaves out Trash, includes archived, drops what was marked not done, lists sub-tasks with their parent", async () => {
    const who = await createTestUser("done-states");
    await task(who, "Trashed", { ...done(at(D, "10:00")), deletedAt: new Date() });
    await task(who, "Archived", { ...done(at(D, "10:01")), archivedAt: new Date() });
    await task(who, "Reopened", { status: "PLANNED", completedAt: null });
    await todo(who, "Trashed todo", {
      isComplete: true,
      completedAt: at(D, "10:02"),
      deletedAt: new Date(),
    });
    const parent = await task(who, "Release", { status: "IN_PROGRESS" });
    await task(who, "Write notes", { ...done(at(D, "11:00")), parentTaskId: parent });
    const result = await getDoneOnDay(who.id, D, PREFS);
    expect(result.items.map((i) => i.title)).toEqual(["Archived", "Write notes"]);
    expect(result.items[1]!.parentTitle).toBe("Release");
  });

  it("lists each completed occurrence of a repeating task", async () => {
    const who = await createTestUser("done-repeat");
    // Completing a repeating task leaves a DONE row behind and makes a new open one for the next date.
    const first = await task(who, "Water plants", { recurrenceRule: "FREQ=DAILY", dueDate: D });
    const firstDone = await completeTask(who.id, first, at(D, "08:00"));
    const second = firstDone.nextOccurrenceId!;
    await completeTask(who.id, second, at(D, "18:00"));
    const result = await getDoneOnDay(who.id, D, PREFS);
    expect(result.items.map((i) => i.title)).toEqual(["Water plants", "Water plants"]);
    expect(result.total).toBe(2);
    // The occurrence that is still open is not listed.
    expect(result.items.map((i) => i.id)).toEqual([first, second]);
  });

  it("caps the list and still reports the true total", async () => {
    const who = await createTestUser("done-cap");
    await db.insert(tasks).values(
      Array.from({ length: DONE_LIMIT + 7 }, (_, i) => ({
        userId: who.id,
        title: `Done ${i}`,
        sortOrder: 0,
        ...done(new Date(at(D, "06:00").getTime() + i * 1000)),
      })),
    );
    const result = await getDoneOnDay(who.id, D, PREFS);
    expect(result.items).toHaveLength(DONE_LIMIT);
    expect(result.total).toBe(DONE_LIMIT + 7);
  });

  it("countDoneByDay counts several days in one query and never another person's work", async () => {
    const who = await createTestUser("done-counts");
    await task(who, "One", done(at(D, "10:00")));
    await todo(who, "Two", { isComplete: true, completedAt: at(D, "11:00") });
    await task(who, "Next", done(at(addDays(D, 1), "10:00")));
    await task(bob, "Bob's", done(at(D, "10:00")));
    const counts = await countDoneByDay(who.id, [D, addDays(D, 1), addDays(D, 2)], PREFS);
    expect([...counts.entries()]).toEqual([
      [D, 2],
      [addDays(D, 1), 1],
      [addDays(D, 2), 0],
    ]);
  });
});

describe("migration 0020", () => {
  it("leaves every ordinary note with no journal date", async () => {
    const who = await createTestUser("plain-note");
    actAs(who);
    const id = ok(await createNote({ title: "Plain" })).id;
    expect((await db.select().from(notes).where(eq(notes.id, id)))[0]!.journalDate).toBeNull();
  });
});
