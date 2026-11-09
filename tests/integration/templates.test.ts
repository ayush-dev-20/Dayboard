import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createNote } from "@/actions/notes";
import { restoreTrashItem, permanentlyDeleteTrashItem } from "@/actions/trash";
import {
  addStarterTemplates,
  createNoteFromTemplate,
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  listTemplatePicks,
  permanentlyDeleteTemplate,
  restoreTemplate,
  saveTemplate,
  setJournalTemplate,
  updateTemplateMeta,
} from "@/actions/templates";
import { db } from "@/db/client";
import { searchWorkspace } from "@/db/queries/search";
import { countNotes, getNote, listNotes } from "@/db/queries/notes";
import { getJournalTemplate, getTemplate, listTemplates } from "@/db/queries/templates";
import { listTrash, trashCounts } from "@/db/queries/trash";
import { notes, projects, templates, userPreferences } from "@/db/schema";
import { TEMPLATE_LIMIT } from "@/lib/templates/types";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 03 against a real database: ownership on every route, versioned saves with a server-built text copy, the
// template rules, using a template (placeholders filled once, the template untouched), the limit, Trash, starters, the
// journal link, and that templates never show up as notes.

let alice: TestUser;
let bob: TestUser;
const GONE = "00000000-0000-4000-8000-000000000000";

beforeAll(async () => {
  alice = await createTestUser("alice-templates");
  bob = await createTestUser("bob-templates");
});

const p = (value: string) => ({ type: "paragraph", content: [{ type: "text", text: value }] });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const rowOf = async (id: string) =>
  (await db.select().from(templates).where(eq(templates.id, id)))[0]!;

async function make(who: TestUser, over: Record<string, unknown> = {}) {
  actAs(who);
  return ok(await createTemplate({ name: "Standup", ...over }));
}

describe("creating and saving", () => {
  it("makes a template with a default name, and builds the text copy on the server", async () => {
    actAs(alice);
    const blank = ok(await createTemplate({}));
    expect((await rowOf(blank.id)).name).toBe("Untitled template");
    const t = await make(alice, {
      titlePattern: "Meeting: {{date}}",
      contentJson: doc(p("Agenda"), p("Notes here")),
    });
    const row = await rowOf(t.id);
    expect(row.contentText).toContain("Agenda");
    expect(row.contentText).toContain("Notes here");
    expect(row.titlePattern).toBe("Meeting: {{date}}");
  });

  it("refuses a name that is empty or too long, and a client-sent text copy, owner or starter key", async () => {
    actAs(alice);
    expect(errorOf(await createTemplate({ name: "   " })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createTemplate({ name: "x".repeat(121) })).code).toBe("VALIDATION_ERROR");
    for (const extra of [
      { contentText: "forged" },
      { userId: bob.id },
      { starterKey: "meeting-notes" },
    ]) {
      expect(errorOf(await createTemplate(extra)).code).toBe("VALIDATION_ERROR");
    }
    expect(errorOf(await createTemplate({ titlePattern: "x".repeat(301) })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("refuses images, files and sub-notes with a plain message, and nothing is saved", async () => {
    const t = await make(alice);
    const image = {
      type: "image",
      attrs: { attachmentId: "01a10706-5c6c-71c5-8918-4a14691a0cfe" },
    };
    const subNote = { type: "subNote", attrs: { noteId: "01a10706-5c6c-71c5-8918-4a14691a0cfe" } };
    for (const node of [image, subNote]) {
      const refused = errorOf(
        await saveTemplate({ id: t.id, version: 1, contentJson: doc(p("x"), node) }),
      );
      expect(refused.code).toBe("VALIDATION_ERROR");
      expect(JSON.stringify(refused)).toContain("images, files or sub-notes");
    }
    expect(errorOf(await createTemplate({ contentJson: doc(image) })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect((await rowOf(t.id)).version).toBe(1);
  });

  it("saves with the version it started from, bumps it, and says conflict as data when stale", async () => {
    const t = await make(alice);
    const first = ok(await saveTemplate({ id: t.id, version: 1, contentJson: doc(p("one")) }));
    expect(first).toMatchObject({ outcome: "saved", version: 2 });
    const stale = ok(await saveTemplate({ id: t.id, version: 1, contentJson: doc(p("two")) }));
    expect(stale).toEqual({ outcome: "conflict", version: 2 });
    expect((await rowOf(t.id)).contentText).toBe("one");
    // Renaming and a title pattern ride along with a save.
    const next = ok(
      await saveTemplate({ id: t.id, version: 2, name: "Renamed", titlePattern: "Hi {{day}}" }),
    );
    expect(next.outcome).toBe("saved");
    expect(await rowOf(t.id)).toMatchObject({ name: "Renamed", titlePattern: "Hi {{day}}" });
  });

  it("changes the name and emoji without a version bump", async () => {
    const t = await make(alice);
    ok(await updateTemplateMeta({ id: t.id, name: "Weekly", emoji: "🗓️" }));
    expect(await rowOf(t.id)).toMatchObject({ name: "Weekly", emoji: "🗓️", version: 1 });
  });
});

describe("ownership", () => {
  it("another person's template is NOT_FOUND by every route, and signed out is UNAUTHENTICATED", async () => {
    const t = await make(alice, { contentJson: doc(p("secret")) });
    actAs(bob);
    expect(await getTemplate(bob.id, t.id)).toBeNull();
    for (const result of [
      await saveTemplate({ id: t.id, version: 1, name: "x" }),
      await updateTemplateMeta({ id: t.id, name: "x" }),
      await duplicateTemplate({ id: t.id }),
      await deleteTemplate({ id: t.id }),
      await restoreTemplate({ id: t.id }),
      await permanentlyDeleteTemplate({ id: t.id }),
      await createNoteFromTemplate({ templateId: t.id }),
      await setJournalTemplate({ templateId: t.id }),
    ]) {
      expect(errorOf(result).code).toBe("NOT_FOUND");
    }
    expect((await listTemplates(bob.id)).some((x) => x.id === t.id)).toBe(false);
    actAs(null);
    expect(errorOf(await createTemplate({})).code).toBe("UNAUTHENTICATED");
    expect(errorOf(await createNoteFromTemplate({ templateId: t.id })).code).toBe(
      "UNAUTHENTICATED",
    );
    expect((await rowOf(t.id)).deletedAt).toBeNull();
  });
});

describe("using a template", () => {
  it("makes the note now, with the pattern as the title and placeholders filled in once, and leaves the template alone", async () => {
    const t = await make(alice, {
      emoji: "📝",
      titlePattern: "Meeting: {{date}}",
      contentJson: doc(p("On {{day}} at {{time}} about {{title}}"), p("{{ date }} stays {{nope}}")),
    });
    actAs(alice);
    const before = await rowOf(t.id);
    const made = ok(await createNoteFromTemplate({ templateId: t.id }));
    const note = (await getNote(alice.id, made.id))!;
    expect(note.title).toMatch(/^Meeting: \d{1,2} [A-Z][a-z]+ \d{4}$/);
    expect(note.emoji).toBe("📝");
    const text = JSON.stringify(note.contentJson);
    expect(text).toContain("about Meeting: ");
    expect(text).not.toContain("{{day}}");
    expect(text).not.toContain("{{time}}");
    expect(text).toContain("{{ date }} stays {{nope}}");
    // The note's text copy was built, and the template is exactly as it was.
    const [row] = await db.select().from(notes).where(eq(notes.id, made.id));
    expect(row!.contentText).toContain("Meeting: ");
    expect(await rowOf(t.id)).toMatchObject({
      version: before.version,
      contentText: before.contentText,
    });
    expect(JSON.stringify((await rowOf(t.id)).contentJson)).toContain("{{day}}");
  });

  it("assigns a project only when it is the person's own", async () => {
    const t = await make(alice, { contentJson: doc(p("x")) });
    const [mine] = await db
      .insert(projects)
      .values({ userId: alice.id, name: "Mine" })
      .returning({ id: projects.id });
    const [theirs] = await db
      .insert(projects)
      .values({ userId: bob.id, name: "Theirs" })
      .returning({ id: projects.id });
    actAs(alice);
    const made = ok(await createNoteFromTemplate({ templateId: t.id, projectId: mine!.id }));
    expect((await getNote(alice.id, made.id))!.project?.id).toBe(mine!.id);
    expect(
      errorOf(await createNoteFromTemplate({ templateId: t.id, projectId: theirs!.id })).code,
    ).toBe("NOT_FOUND");
  });

  it("cannot use a template in Trash, or one whose stored text no longer passes the checks", async () => {
    const t = await make(alice, { contentJson: doc(p("x")) });
    actAs(alice);
    ok(await deleteTemplate({ id: t.id }));
    expect(errorOf(await createNoteFromTemplate({ templateId: t.id })).code).toBe("NOT_FOUND");

    const old = await make(alice, { contentJson: doc(p("x")) });
    // Saved under older rules: an image block sits in the stored text.
    await db
      .update(templates)
      .set({ contentJson: doc(p("x"), { type: "image", attrs: { attachmentId: GONE } }) as never })
      .where(eq(templates.id, old.id));
    actAs(alice);
    expect(errorOf(await createNoteFromTemplate({ templateId: old.id })).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("the limit and duplicating", () => {
  it("allows 50 live templates; the 51st, and a duplicate at the limit, are QUOTA_EXCEEDED", async () => {
    const who = await createTestUser("limit-templates");
    actAs(who);
    await db.insert(templates).values(
      Array.from({ length: TEMPLATE_LIMIT }, (_, i) => ({
        userId: who.id,
        name: `T${i}`,
        contentJson: doc() as never,
      })),
    );
    expect(errorOf(await createTemplate({})).code).toBe("QUOTA_EXCEEDED");
    const [first] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.userId, who.id))
      .limit(1);
    expect(errorOf(await duplicateTemplate({ id: first!.id })).code).toBe("QUOTA_EXCEEDED");
    // Trash frees a place; starters count against the limit too.
    ok(await deleteTemplate({ id: first!.id }));
    expect(ok(await createTemplate({})).id).toBeTruthy();
    expect(errorOf(await addStarterTemplates({ keys: ["meeting-notes"] })).code).toBe(
      "QUOTA_EXCEEDED",
    );
  });

  it("names a copy '<name> copy', cut to the limit, and never carries a starter key", async () => {
    actAs(alice);
    const starter = ok(await addStarterTemplates({ keys: ["meeting-notes"] }));
    expect(starter.added).toContain("meeting-notes");
    const [src] = await db
      .select()
      .from(templates)
      .where(
        and(
          eq(templates.userId, alice.id),
          eq(templates.starterKey, "meeting-notes"),
          isNull(templates.deletedAt),
        ),
      );
    const copy = ok(await duplicateTemplate({ id: src!.id }));
    const row = await rowOf(copy.id);
    expect(row.name).toBe("Meeting notes copy");
    expect(row.starterKey).toBeNull();
    expect(row.contentJson).toEqual(src!.contentJson);

    const long = await make(alice, { name: "n".repeat(120) });
    actAs(alice);
    const longCopy = ok(await duplicateTemplate({ id: long.id }));
    expect((await rowOf(longCopy.id)).name).toHaveLength(120);
  });
});

describe("Trash", () => {
  it("deletes to Trash, restores, and deletes for good; Trash lists it as a template", async () => {
    const who = await createTestUser("trash-templates");
    actAs(who);
    const t = ok(await createTemplate({ name: "Trashable", emoji: "🧾" }));
    ok(await deleteTemplate({ id: t.id }));
    expect(await getTemplate(who.id, t.id)).toBeNull();
    expect((await listTrash(who.id)).items.find((i) => i.id === t.id)).toMatchObject({
      type: "template",
      title: "Trashable",
    });
    expect((await trashCounts(who.id)).template).toBe(1);

    const back = ok(await restoreTrashItem({ type: "template", id: t.id }));
    expect(back.href).toBe(`/templates/${t.id}`);
    expect(await getTemplate(who.id, t.id)).not.toBeNull();

    ok(await deleteTemplate({ id: t.id }));
    ok(await permanentlyDeleteTrashItem({ type: "template", id: t.id }));
    expect(await db.select().from(templates).where(eq(templates.id, t.id))).toHaveLength(0);
  });

  it("will not delete a live template for good", async () => {
    const t = await make(alice);
    actAs(alice);
    expect(errorOf(await permanentlyDeleteTemplate({ id: t.id })).code).toBe("NOT_FOUND");
  });

  it("deleting the journal template clears the choice, and restoring does not set it again", async () => {
    const who = await createTestUser("journal-clear");
    actAs(who);
    const t = ok(await createTemplate({ name: "Daily" }));
    ok(await setJournalTemplate({ templateId: t.id }));
    expect((await listTemplates(who.id))[0]!.isJournal).toBe(true);
    ok(await deleteTemplate({ id: t.id }));
    const prefs = (
      await db.select().from(userPreferences).where(eq(userPreferences.userId, who.id))
    )[0]!;
    expect(prefs.journalTemplateId).toBeNull();
    ok(await restoreTemplate({ id: t.id }));
    expect((await listTemplates(who.id))[0]!.isJournal).toBe(false);
  });
});

describe("starters", () => {
  it("adds each once, reports what it skipped, and never overwrites an edited copy", async () => {
    const who = await createTestUser("starters");
    actAs(who);
    const first = ok(await addStarterTemplates({ keys: ["meeting-notes", "weekly-plan"] }));
    expect(first).toEqual({ added: ["meeting-notes", "weekly-plan"], skipped: [] });

    const [meeting] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.userId, who.id), eq(templates.starterKey, "meeting-notes")));
    ok(
      await saveTemplate({
        id: meeting!.id,
        version: 1,
        contentJson: doc(p("My own layout")),
        name: "My meeting",
      }),
    );

    const again = ok(
      await addStarterTemplates({ keys: ["meeting-notes", "weekly-plan", "daily-journal"] }),
    );
    expect(again).toEqual({ added: ["daily-journal"], skipped: ["meeting-notes", "weekly-plan"] });
    expect(await rowOf(meeting!.id)).toMatchObject({
      name: "My meeting",
      contentText: "My own layout",
    });
    expect(await db.select().from(templates).where(eq(templates.userId, who.id))).toHaveLength(3);
  });

  it("refuses an unknown starter and an empty list", async () => {
    actAs(alice);
    expect(errorOf(await addStarterTemplates({ keys: ["nope"] })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await addStarterTemplates({ keys: [] })).code).toBe("VALIDATION_ERROR");
  });

  it("a trashed starter's copy can be added again, and restoring the old one then conflicts", async () => {
    const who = await createTestUser("starter-restore");
    actAs(who);
    ok(await addStarterTemplates({ keys: ["project-brief"] }));
    const [row] = await db.select().from(templates).where(eq(templates.userId, who.id));
    ok(await deleteTemplate({ id: row!.id }));
    expect(ok(await addStarterTemplates({ keys: ["project-brief"] })).added).toEqual([
      "project-brief",
    ]);
    expect(errorOf(await restoreTemplate({ id: row!.id })).code).toBe("CONFLICT");
  });
});

describe("the journal template", () => {
  it("sets, reads and clears the choice, and only for the person's own live template", async () => {
    const who = await createTestUser("journal-set");
    actAs(who);
    expect(await getJournalTemplate(who.id)).toBeNull();
    const t = ok(await createTemplate({ name: "Day", contentJson: doc(p("Morning")) }));
    ok(await setJournalTemplate({ templateId: t.id }));
    expect((await getJournalTemplate(who.id))?.id).toBe(t.id);
    expect(errorOf(await setJournalTemplate({ templateId: GONE })).code).toBe("NOT_FOUND");
    const other = await make(bob);
    actAs(who);
    expect(errorOf(await setJournalTemplate({ templateId: other.id })).code).toBe("NOT_FOUND");
    ok(await setJournalTemplate({ templateId: null }));
    expect(await getJournalTemplate(who.id)).toBeNull();
  });

  it("gives nothing when the chosen template is in Trash or no longer valid, so an entry starts empty", async () => {
    const who = await createTestUser("journal-degrade");
    actAs(who);
    const t = ok(await createTemplate({ name: "Day", contentJson: doc(p("Morning")) }));
    ok(await setJournalTemplate({ templateId: t.id }));
    await db.update(templates).set({ deletedAt: new Date() }).where(eq(templates.id, t.id));
    expect(await getJournalTemplate(who.id)).toBeNull();
    await db
      .update(templates)
      .set({
        deletedAt: null,
        contentJson: doc({ type: "image", attrs: { attachmentId: GONE } }) as never,
      })
      .where(eq(templates.id, t.id));
    expect(await getJournalTemplate(who.id)).toBeNull();
  });
});

describe("templates are not notes", () => {
  it("never show up in the Notes list, counts or search, and the picker lists only the person's own", async () => {
    const who = await createTestUser("not-notes");
    actAs(who);
    ok(await createTemplate({ name: "Hidden starter", contentJson: doc(p("zebra stripes")) }));
    const real = ok(await createNote({ title: "A real note" }));
    expect((await listNotes(who.id)).map((n) => n.id)).toEqual([real.id]);
    expect(await countNotes(who.id)).toEqual({ active: 1, archived: 0 });
    const hits = await searchWorkspace(
      who.id,
      { q: "zebra", tab: "all", status: null, projectId: null, tagId: null, from: null, to: null },
      { timezone: "UTC", startOfDay: "06:00" },
      10,
    );
    expect(hits.total).toBe(0);
    const picks = ok(await listTemplatePicks());
    expect(picks.map((x) => x.name)).toEqual(["Hidden starter"]);
    actAs(bob);
    expect(ok(await listTemplatePicks()).some((x) => x.name === "Hidden starter")).toBe(false);
  });
});
