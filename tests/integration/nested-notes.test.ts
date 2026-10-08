import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  archiveNote,
  createLinkedNoteForTask,
  createNote,
  createSubNote,
  deleteNote,
  findNotesForLink,
  getNoteMetas,
  loadBacklinks,
  moveNote,
  permanentlyDeleteNote,
  restoreNote,
  restoreNoteAsTopLevel,
  saveNoteContent,
  saveNoteTitle,
} from "@/actions/notes";
import { assignToProject, createProject } from "@/actions/projects";
import {
  createTask,
  deleteTask,
  permanentlyDeleteTask,
  updateTaskDescription,
} from "@/actions/tasks";
import { emptyTrash, restoreTrashItem } from "@/actions/trash";
import { db } from "@/db/client";
import {
  getBacklinks,
  getBreadcrumb,
  getChildren,
  getNoteTree,
  getOutline,
} from "@/db/queries/note-tree";
import { countNotes, getNote, listNotes } from "@/db/queries/notes";
import { listNotesForViews } from "@/db/queries/views";
import { listTrash, trashedSubNoteCount } from "@/db/queries/trash";
import { noteLinks, notes, taskNotes } from "@/db/schema";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V2 feature 07 against the real actions and database: sub-notes, moving, cascades with exact
// restore sets, note links and backlinks, and ownership.

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-nested");
  bob = await createTestUser("bob-nested");
});

const text = (t: string) => ({ type: "text", text: t });
const link = (noteId: string) => ({ type: "noteLink", attrs: { noteId } });
const para = (...content: unknown[]) => ({ type: "paragraph", content });
const doc = (...content: unknown[]) => ({ type: "doc", content });
const block = (noteId: string) => ({ type: "subNote", attrs: { noteId } });

async function top(title: string, who: TestUser = alice) {
  actAs(who);
  return ok(await createNote({ title })).id;
}
async function sub(parentId: string, title: string, who: TestUser = alice) {
  actAs(who);
  return ok(await createSubNote({ parentId, title })).id;
}
const row = async (id: string) => (await db.select().from(notes).where(eq(notes.id, id)))[0]!;
const live = async (ids: string[]) =>
  (
    await db
      .select({ id: notes.id, deletedAt: notes.deletedAt })
      .from(notes)
      .where(inArray(notes.id, ids))
  )
    .filter((r) => r.deletedAt === null)
    .map((r) => r.id)
    .sort();

describe("creating a sub-note", () => {
  it("goes under the parent, one level down, in the parent's project, with no tags, first among siblings", async () => {
    actAs(alice);
    const project = ok(await createProject({ name: "Launch" }));
    const parent = await top("Parent");
    ok(await assignToProject({ itemType: "note", itemId: parent, projectId: project.id }));

    const first = await sub(parent, "First");
    const second = await sub(parent, "Second");
    const created = await row(second);
    expect(created).toMatchObject({ parentNoteId: parent, depth: 2, projectId: project.id });
    expect((await row(second)).sortOrder).toBeLessThan((await row(first)).sortOrder);
    expect((await getChildren(alice.id, parent)).map((c) => c.id)).toEqual([second, first]);
  });

  it("refuses to go deeper than five levels, with the clear message", async () => {
    let parent = await top("L1");
    for (let level = 2; level <= 5; level++) parent = await sub(parent, `L${level}`);
    expect((await row(parent)).depth).toBe(5);
    actAs(alice);
    const result = await createSubNote({ parentId: parent, title: "Too deep" });
    expect(errorOf(result)).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Notes can be nested five levels deep.",
    });
  });

  it("refuses a parent that is archived, in Trash, missing, or someone else's", async () => {
    const archived = await top("Archived parent");
    actAs(alice);
    ok(await archiveNote({ id: archived, archived: true }));
    expect(errorOf(await createSubNote({ parentId: archived })).code).toBe("VALIDATION_ERROR");

    const trashed = await top("Trashed parent");
    ok(await deleteNote({ id: trashed }));
    expect(errorOf(await createSubNote({ parentId: trashed })).code).toBe("NOT_FOUND");

    const bobs = await top("Bob's", bob);
    actAs(alice);
    expect(errorOf(await createSubNote({ parentId: bobs })).code).toBe("NOT_FOUND");
  });

  it("a new top-level note goes to the top of the top level, not mixed with sub-notes", async () => {
    const parent = await top("Order parent");
    await sub(parent, "Child");
    const newest = await top("Newest top");
    const roots = (await getOutline(alice.id)).filter((n) => n.parentId === null);
    expect(roots[0]?.id).toBe(newest);
  });
});

describe("moving a note", () => {
  it("moves a note and its sub-notes, and recomputes depth for the whole subtree", async () => {
    const a = await top("A");
    const a1 = await sub(a, "A1");
    const a11 = await sub(a1, "A11");
    const b = await top("B");
    const b1 = await sub(b, "B1");

    actAs(alice);
    const moved = ok(await moveNote({ id: a, parentId: b1 }));
    expect(moved).toMatchObject({ depth: 3, parentId: b1 });
    expect([(await row(a)).depth, (await row(a1)).depth, (await row(a11)).depth]).toEqual([
      3, 4, 5,
    ]);
    expect((await getBreadcrumb(alice.id, a11)).map((c) => c.id)).toEqual([b, b1, a, a1]);

    // And back to the top level.
    ok(await moveNote({ id: a, parentId: null }));
    expect([(await row(a)).depth, (await row(a1)).depth, (await row(a11)).depth]).toEqual([
      1, 2, 3,
    ]);
  });

  it("refuses a loop: into itself or into one of its own sub-notes", async () => {
    const a = await top("Loop A");
    const a1 = await sub(a, "Loop A1");
    const a11 = await sub(a1, "Loop A11");
    actAs(alice);
    for (const parentId of [a, a1, a11]) {
      expect(errorOf(await moveNote({ id: a, parentId })).code).toBe("VALIDATION_ERROR");
    }
    expect((await row(a)).parentNoteId).toBeNull();
  });

  it("checks the depth of the whole subtree, including sub-notes in Trash", async () => {
    const parent = await top("Depth parent");
    const mid = await sub(parent, "Mid"); // level 2
    const deep = await sub(mid, "Deep"); // level 3
    const trashedLeaf = await sub(deep, "Trashed leaf"); // level 4
    actAs(alice);
    ok(await deleteNote({ id: trashedLeaf }));

    const target = await top("Target");
    const t2 = await sub(target, "T2");
    const t3 = await sub(t2, "T3"); // level 3
    // `mid` has two levels below it (deep and the trashed leaf): under level 3 it would end at 6.
    const refused = await moveNote({ id: mid, parentId: t3 });
    expect(errorOf(refused).message).toBe("Notes can be nested five levels deep.");
    // Under level 2 it ends at level 5: allowed.
    ok(await moveNote({ id: mid, parentId: t2 }));
    expect((await row(trashedLeaf)).depth).toBe(5);
  });

  it("places a note between two siblings and does not change 'last updated'", async () => {
    const parent = await top("Sibling parent");
    const x = await sub(parent, "X");
    const y = await sub(parent, "Y");
    const z = await sub(parent, "Z"); // order: Z, Y, X
    const before = (await row(y)).updatedAt;
    actAs(alice);
    ok(await moveNote({ id: x, parentId: parent, beforeId: z, afterId: y }));
    expect((await getChildren(alice.id, parent)).map((c) => c.id)).toEqual([z, x, y]);
    expect((await row(y)).updatedAt).toEqual(before);
    expect((await row(x)).updatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("a neighbour that is not a sibling at the destination is refused", async () => {
    const a = await top("N-A");
    const b = await top("N-B");
    const b1 = await sub(b, "N-B1");
    actAs(alice);
    expect(errorOf(await moveNote({ id: a, parentId: null, beforeId: b1 })).code).toBe("NOT_FOUND");
  });

  it("someone else's note or parent is not found, and nothing moves", async () => {
    const mine = await top("Mine");
    const theirs = await top("Theirs", bob);
    actAs(alice);
    expect(errorOf(await moveNote({ id: theirs, parentId: null })).code).toBe("NOT_FOUND");
    expect(errorOf(await moveNote({ id: mine, parentId: theirs })).code).toBe("NOT_FOUND");
    expect((await row(mine)).parentNoteId).toBeNull();
  });

  it("two devices moving notes into each other cannot make a loop: one is refused", async () => {
    const x = await top("Race X");
    const y = await top("Race Y");
    actAs(alice);
    const [first, second] = await Promise.all([
      moveNote({ id: x, parentId: y }),
      moveNote({ id: y, parentId: x }),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok)!;
    expect(errorOf(failed).code).toBe("VALIDATION_ERROR");
    const [rx, ry] = [await row(x), await row(y)];
    expect([rx.parentNoteId, ry.parentNoteId].filter(Boolean)).toHaveLength(1);
  });
});

describe("Trash and archive follow the hierarchy", () => {
  async function family(prefix: string) {
    const p = await top(`${prefix} parent`);
    const a = await sub(p, `${prefix} a`);
    const a1 = await sub(a, `${prefix} a1`);
    const b = await sub(p, `${prefix} b`);
    return { p, a, a1, b, all: [p, a, a1, b] };
  }

  it("trashing a parent takes every sub-note, and one restore brings them all back", async () => {
    const f = await family("Trash");
    actAs(alice);
    const deleted = ok(await deleteNote({ id: f.p }));
    expect(deleted.subNotes).toBe(3);
    expect(await live(f.all)).toEqual([]);
    const cascade = new Set((await Promise.all(f.all.map(row))).map((r) => r.deletedCascadeId));
    expect(cascade.size).toBe(1);
    expect([...cascade][0]).not.toBeNull();

    const restored = ok(await restoreNote({ id: f.p }));
    expect(restored).toEqual({ restored: 4, subNotes: 3 });
    expect(await live(f.all)).toEqual([...f.all].sort());
    expect((await row(f.a)).deletedCascadeId).toBeNull();
  });

  it("restoring the parent restores exactly its set: a sub-note trashed earlier stays in Trash", async () => {
    const f = await family("Exact");
    actAs(alice);
    ok(await deleteNote({ id: f.a })); // a and a1, on their own
    ok(await deleteNote({ id: f.p })); // p and b
    ok(await restoreNote({ id: f.p }));
    expect(await live(f.all)).toEqual([f.b, f.p].sort());
    // The earlier one comes back by itself, under its (live) parent.
    ok(await restoreNote({ id: f.a }));
    expect(await live(f.all)).toEqual([...f.all].sort());
    expect((await row(f.a)).parentNoteId).toBe(f.p);
  });

  it("restoring a sub-note whose parent is in Trash asks first, then returns it as a top-level note", async () => {
    const f = await family("Alone");
    actAs(alice);
    ok(await deleteNote({ id: f.p }));
    const asked = await restoreNote({ id: f.a });
    expect(errorOf(asked)).toMatchObject({
      code: "CONFLICT",
      fieldErrors: { parent: "top-level" },
    });
    expect(await live([f.a])).toEqual([]);

    const restored = ok(await restoreNoteAsTopLevel({ id: f.a }));
    expect(restored.restored).toBe(2); // a and a1
    const [a, a1, p] = [await row(f.a), await row(f.a1), await row(f.p)];
    expect([a.parentNoteId, a.depth, a1.depth, a.deletedAt]).toEqual([null, 1, 2, null]);
    expect(a1.parentNoteId).toBe(f.a);
    expect(p.deletedAt).not.toBeNull();
    // The rest of the old group is still together in Trash.
    expect(await live([f.p, f.b])).toEqual([]);
  });

  it("restoring from the Trash screen's action asks the same question", async () => {
    const f = await family("Screen");
    actAs(alice);
    ok(await deleteNote({ id: f.p }));
    const asked = await restoreTrashItem({ type: "note", id: f.b });
    expect(errorOf(asked).fieldErrors?.parent).toBe("top-level");
    ok(await restoreTrashItem({ type: "note", id: f.b, asTopLevel: true }));
    expect((await row(f.b)).parentNoteId).toBeNull();
  });

  it("Trash lists the top of a cascade and says how many went with it; a nested one is not listed twice", async () => {
    const person = await createTestUser("trash-lister");
    const p = await top("Listed parent", person);
    const c = await sub(p, "Listed child", person);
    await sub(c, "Listed grandchild", person);
    actAs(person);
    ok(await deleteNote({ id: p }));
    const { items } = await listTrash(person.id);
    const notesListed = items.filter((i) => i.type === "note");
    expect(notesListed).toHaveLength(1);
    expect(notesListed[0]).toMatchObject({ id: p, subNotes: 2, descendants: 2 });
    expect(await trashedSubNoteCount(person.id)).toBe(2);
  });

  it("a sub-note trashed alone is listed on its own, and its parent is untouched", async () => {
    const f = await family("Solo");
    actAs(alice);
    ok(await deleteNote({ id: f.b }));
    expect(await live([f.p, f.a, f.a1])).toEqual([f.p, f.a, f.a1].sort());
    expect((await getChildren(alice.id, f.p)).map((c) => c.id)).toEqual([f.a]);
  });

  it("archiving a parent archives its sub-notes, and unarchiving restores the same set", async () => {
    const f = await family("Arch");
    actAs(alice);
    ok(await archiveNote({ id: f.b, archived: true })); // b on its own
    const result = ok(await archiveNote({ id: f.p, archived: true }));
    expect(result.subNotes).toBe(2); // a and a1 (b was already archived)

    ok(await archiveNote({ id: f.p, archived: false }));
    const states = await Promise.all(
      f.all.map(async (id) => [id, (await row(id)).archivedAt === null] as const),
    );
    expect(Object.fromEntries(states)).toEqual({
      [f.p]: true,
      [f.a]: true,
      [f.a1]: true,
      [f.b]: false, // archived earlier, on its own, so it stays archived
    });
  });

  it("unarchiving a sub-note whose parent is archived asks, then returns it as top level", async () => {
    const f = await family("ArchAlone");
    actAs(alice);
    ok(await archiveNote({ id: f.p, archived: true }));
    const asked = await archiveNote({ id: f.a, archived: false });
    expect(errorOf(asked)).toMatchObject({
      code: "CONFLICT",
      fieldErrors: { parent: "top-level" },
    });
    ok(await archiveNote({ id: f.a, archived: false, asTopLevel: true }));
    const [a, a1] = [await row(f.a), await row(f.a1)];
    expect([a.parentNoteId, a.depth, a1.depth, a.archivedAt]).toEqual([null, 1, 2, null]);
  });

  it("archived and trashed notes are not in the sidebar tree, but a note is never hidden from its parent", async () => {
    const person = await createTestUser("tree-reader");
    const p = await top("Tree parent", person);
    const keep = await sub(p, "Keep", person);
    const archived = await sub(p, "Archived child", person);
    const trashed = await sub(p, "Trashed child", person);
    actAs(person);
    ok(await archiveNote({ id: archived, archived: true }));
    ok(await deleteNote({ id: trashed }));
    const tree = await getNoteTree(person.id);
    expect(tree.rows.map((r) => r.id).sort()).toEqual([p, keep].sort());
    const children = await getChildren(person.id, p);
    expect(children.map((c) => [c.id, c.archived])).toEqual(
      expect.arrayContaining([
        [keep, false],
        [archived, true],
      ]),
    );
    expect(children.map((c) => c.id)).not.toContain(trashed);
  });

  it("permanent delete removes the subtree, names what it removed, and works only from Trash", async () => {
    const f = await family("Perm");
    actAs(alice);
    expect(errorOf(await permanentlyDeleteNote({ id: f.p })).code).toBe("CONFLICT");
    ok(await deleteNote({ id: f.p }));
    const removed = ok(await permanentlyDeleteNote({ id: f.p }));
    expect(removed).toEqual({ removed: 4, subNotes: 3 });
    expect((await db.select().from(notes).where(inArray(notes.id, f.all))).length).toBe(0);
  });

  it("emptying Trash removes trashed sub-notes with their parents", async () => {
    const person = await createTestUser("emptier");
    const p = await top("Empty parent", person);
    await sub(p, "Empty child", person);
    actAs(person);
    ok(await deleteNote({ id: p }));
    const result = ok(await emptyTrash({}));
    expect(result.deleted).toBe(2);
    expect((await listTrash(person.id)).items).toHaveLength(0);
  });

  it("someone else's note can't be trashed, restored, archived or deleted for good", async () => {
    const theirs = await top("Not yours", bob);
    actAs(alice);
    for (const result of [
      await deleteNote({ id: theirs }),
      await restoreNote({ id: theirs }),
      await archiveNote({ id: theirs, archived: true }),
      await permanentlyDeleteNote({ id: theirs }),
    ]) {
      expect(errorOf(result).code).toBe("NOT_FOUND");
    }
    expect((await row(theirs)).deletedAt).toBeNull();
  });
});

describe("note links and 'Linked from'", () => {
  const linksOf = (sourceId: string) =>
    db.select().from(noteLinks).where(eq(noteLinks.sourceId, sourceId));

  it("rebuilds the rows on every save: added, kept once per target, and removed", async () => {
    const target = await top("Link target");
    const other = await top("Other target");
    const source = await top("Link source");
    actAs(alice);
    const note = (await getNote(alice.id, source))!;

    let version = note.version;
    const save = async (d: unknown) => {
      const saved = ok(await saveNoteContent({ id: source, contentJson: d, baseVersion: version }));
      if (saved.outcome === "saved") version = saved.version;
    };
    await save(doc(para(text("see "), link(target), text(" and "), link(target), link(other))));
    expect((await linksOf(source)).map((r) => r.targetNoteId).sort()).toEqual(
      [target, other].sort(),
    );

    await save(doc(para(link(other))));
    expect((await linksOf(source)).map((r) => r.targetNoteId)).toEqual([other]);
    await save(doc(para(text("none"))));
    expect(await linksOf(source)).toHaveLength(0);
  });

  it("stores the words around the link, and the searchable text names the target", async () => {
    const target = await top("Roadmap");
    const source = await top("Snippet source");
    actAs(alice);
    ok(
      await saveNoteContent({
        id: source,
        contentJson: doc(para(text("Ship the "), link(target), text(" this week."))),
        baseVersion: 1,
      }),
    );
    const [stored] = await linksOf(source);
    expect(stored?.snippet).toBe("Ship the Roadmap this week.");
    expect((await row(source)).contentText).toBe("Ship the Roadmap this week.");
    const backlinks = await getBacklinks(alice.id, target);
    expect(backlinks).toEqual([
      {
        kind: "note",
        id: source,
        title: "Snippet source",
        emoji: null,
        snippet: "Ship the Roadmap this week.",
      },
    ]);
  });

  it("a note linking to itself is not a backlink", async () => {
    const self = await top("Self linker");
    actAs(alice);
    ok(await saveNoteContent({ id: self, contentJson: doc(para(link(self))), baseVersion: 1 }));
    expect(await linksOf(self)).toHaveLength(0);
  });

  it("a link to a note that isn't theirs is kept in the text but stores nothing and reveals nothing", async () => {
    const theirs = await top("Bob's secret", bob);
    const mine = await top("Alice's note");
    actAs(alice);
    ok(await saveNoteContent({ id: mine, contentJson: doc(para(link(theirs))), baseVersion: 1 }));
    expect(await linksOf(mine)).toHaveLength(0);
    // The document keeps the link, which reads as "no longer exists" because Alice can't see it.
    const metas = ok(await getNoteMetas({ ids: [theirs] }));
    expect(metas).toEqual([{ id: theirs, title: "", emoji: null, state: "missing" }]);
    actAs(bob);
    expect(ok(await loadBacklinks({ id: theirs }))).toEqual([]);
  });

  it("task descriptions can link to notes, and show up under 'Linked from' as tasks", async () => {
    const target = await top("Task link target");
    actAs(alice);
    const task = ok(await createTask({ title: "Write the plan" }));
    ok(
      await updateTaskDescription({
        id: task.id,
        descriptionJson: doc(para(text("Based on "), link(target))),
      }),
    );
    const backlinks = ok(await loadBacklinks({ id: target }));
    expect(backlinks).toEqual([
      {
        kind: "task",
        id: task.id,
        title: "Write the plan",
        emoji: null,
        snippet: "Based on Task link target",
      },
    ]);
    // Removing the link removes the row.
    ok(await updateTaskDescription({ id: task.id, descriptionJson: doc(para(text("none"))) }));
    expect(ok(await loadBacklinks({ id: target }))).toEqual([]);
  });

  it("a task description cannot hold a sub-note block", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "No blocks" }));
    const target = await top("Block target");
    const refused = await updateTaskDescription({
      id: task.id,
      descriptionJson: doc(block(target)),
    });
    expect(errorOf(refused).code).toBe("VALIDATION_ERROR");
  });

  it("'New linked note' makes the note, links the task to it, and returns what the editor inserts", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Needs a note" }));
    const made = ok(await createLinkedNoteForTask({ taskId: task.id, title: "Spec" }));
    expect(made).toMatchObject({ title: "Spec", emoji: null });
    const rows = await db.select().from(taskNotes).where(eq(taskNotes.taskId, task.id));
    expect(rows.map((r) => r.noteId)).toEqual([made.id]);
    expect((await row(made.id)).parentNoteId).toBeNull();
  });

  it("someone else's task can't be linked to a new note", async () => {
    actAs(bob);
    const theirs = ok(await createTask({ title: "Bob's task" }));
    actAs(alice);
    expect(errorOf(await createLinkedNoteForTask({ taskId: theirs.id })).code).toBe("NOT_FOUND");
  });

  it("backlinks leave out sources in Trash, and come back with a restore", async () => {
    const target = await top("Trash target");
    const source = await top("Trash source");
    actAs(alice);
    ok(await saveNoteContent({ id: source, contentJson: doc(para(link(target))), baseVersion: 1 }));
    expect((await getBacklinks(alice.id, target)).map((b) => b.id)).toEqual([source]);
    ok(await deleteNote({ id: source }));
    expect(await getBacklinks(alice.id, target)).toEqual([]);
    ok(await restoreNote({ id: source }));
    expect((await getBacklinks(alice.id, target)).map((b) => b.id)).toEqual([source]);
  });

  it("deleting a source for good, or the target, removes its rows", async () => {
    const target = await top("Cleanup target");
    const source = await top("Cleanup source");
    actAs(alice);
    const task = ok(await createTask({ title: "Cleanup task" }));
    ok(await saveNoteContent({ id: source, contentJson: doc(para(link(target))), baseVersion: 1 }));
    ok(await updateTaskDescription({ id: task.id, descriptionJson: doc(para(link(target))) }));
    expect(
      await db.select().from(noteLinks).where(eq(noteLinks.targetNoteId, target)),
    ).toHaveLength(2);

    ok(await deleteNote({ id: source }));
    ok(await permanentlyDeleteNote({ id: source }));
    ok(await deleteTask({ id: task.id }));
    ok(await permanentlyDeleteTask({ id: task.id }));
    expect(
      await db.select().from(noteLinks).where(eq(noteLinks.targetNoteId, target)),
    ).toHaveLength(0);
  });

  it("link states: ok, archived, trashed and gone", async () => {
    const a = await top("State ok");
    const b = await top("State archived");
    const c = await top("State trashed");
    const d = await top("State gone");
    actAs(alice);
    ok(await archiveNote({ id: b, archived: true }));
    ok(await deleteNote({ id: c }));
    ok(await deleteNote({ id: d }));
    ok(await permanentlyDeleteNote({ id: d }));
    const metas = ok(await getNoteMetas({ ids: [a, b, c, d] }));
    expect(Object.fromEntries(metas.map((m) => [m.id, m.state]))).toEqual({
      [a]: "ok",
      [b]: "archived",
      [c]: "trashed",
      [d]: "missing",
    });
    // Renaming updates what a link shows (it holds identity, not the title).
    const base = (await getNote(alice.id, a))!.version;
    ok(await saveNoteTitle({ id: a, title: "Renamed", baseVersion: base }));
    expect(ok(await getNoteMetas({ ids: [a] }))[0]?.title).toBe("Renamed");
  });

  it("the picker offers recent notes, matches title before body, never the note itself, with paths", async () => {
    const person = await createTestUser("picker");
    const parent = await top("Quarterly plan", person);
    const child = await sub(parent, "Budget review", person);
    const other = await top("Budget", person);
    const bodyOnly = await top("Meeting", person);
    actAs(person);
    ok(
      await saveNoteContent({
        id: bodyOnly,
        contentJson: doc(para(text("we discussed the budget"))),
        baseVersion: 1,
      }),
    );

    const hits = ok(await findNotesForLink({ query: "budget", excludeId: other }));
    expect(hits.map((h) => h.id)).toEqual([child, bodyOnly]);
    expect(hits[0]?.path).toEqual(["Quarterly plan"]);
    expect(hits.map((h) => h.id)).not.toContain(other);

    const recent = ok(await findNotesForLink({ query: "", excludeId: null }));
    expect(recent.length).toBe(4);
    expect(ok(await findNotesForLink({ query: "%", excludeId: null }))).toEqual([]);
  });

  it("the picker never shows another person's notes or notes in Trash", async () => {
    const person = await createTestUser("picker-scope");
    const mine = await top("Zebra mine", person);
    await top("Zebra theirs", bob);
    const gone = await top("Zebra gone", person);
    actAs(person);
    ok(await deleteNote({ id: gone }));
    expect(ok(await findNotesForLink({ query: "zebra" })).map((h) => h.id)).toEqual([mine]);
  });
});

describe("the main views list top-level notes only", () => {
  it("leaves sub-notes out of the views, the list and the count; the tree and outline keep them", async () => {
    const person = await createTestUser("views-top");
    const p = await top("Top note", person);
    const c = await sub(p, "Sub note", person);
    await top("Other top", person);
    const inViews = (await listNotesForViews(person.id)).map((n) => n.id);
    expect(inViews).not.toContain(c);
    expect(inViews).toContain(p);
    expect(inViews).toHaveLength(2);
    expect((await listNotes(person.id, { topLevelOnly: true })).map((n) => n.id)).not.toContain(c);
    expect(await countNotes(person.id)).toEqual({ active: 2, archived: 0 });
    // The outline (Tree view) still has it.
    expect((await getOutline(person.id)).map((n) => n.id)).toContain(c);
  });
});

describe("what a note page needs", () => {
  it("returns the breadcrumb, the sub-notes and the depth", async () => {
    const p = await top("Page parent");
    const c = await sub(p, "Page child");
    const g = await sub(c, "Page grandchild");
    const note = (await getNote(alice.id, g))!;
    expect(note.breadcrumb.map((x) => x.id)).toEqual([p, c]);
    expect(note.depth).toBe(3);
    expect((await getNote(alice.id, p))!.children.map((x) => x.id)).toEqual([c]);
  });

  it("the sidebar tree holds the first 50 top-level notes and everything under them", async () => {
    const person = await createTestUser("fifty");
    actAs(person);
    const ids: string[] = [];
    for (let i = 0; i < 52; i++) ids.push(ok(await createNote({ title: `Note ${i}` })).id);
    const childOfLast = await sub(ids[0]!, "Under the oldest", person); // oldest = last in order
    const tree = await getNoteTree(person.id);
    expect(tree.rootTotal).toBe(52);
    expect(tree.rows.filter((r) => r.parentId === null)).toHaveLength(50);
    // The oldest two roots (and so the child under the oldest) are past the first 50.
    expect(tree.rows.map((r) => r.id)).not.toContain(childOfLast);
    expect(tree.rows.map((r) => r.id)).toContain(ids[51]);
  });
});
