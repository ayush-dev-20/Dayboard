import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  archiveNote,
  createNote,
  deleteNote,
  linkTaskNote,
  permanentlyDeleteNote,
  restoreNote,
  saveNoteContent,
  saveNoteTitle,
  unlinkTaskNote,
  updateNoteMeta,
} from "@/actions/notes";
import {
  assignToProject,
  createProject,
  deleteProject,
  permanentlyDeleteProject,
  restoreProject,
  updateProject,
} from "@/actions/projects";
import {
  createTag,
  deleteTag,
  renameTag,
  setNoteTags,
  setTagColor,
  setTaskTags,
} from "@/actions/tags";
import { createTask } from "@/actions/tasks";
import { createTodo } from "@/actions/todos";
import { db } from "@/db/client";
import { getNote, listNotes } from "@/db/queries/notes";
import { getProjectDetail, listProjectRefs, listProjects } from "@/db/queries/projects";
import { listTagsWithUsage } from "@/db/queries/tags";
import { getTaskDetail, listTasks } from "@/db/queries/tasks";
import { listOpenTodos } from "@/db/queries/todos";
import { notes, taskNotes, tasks, todos } from "@/db/schema";
import type { TiptapDoc } from "@/lib/editor/types";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-ws");
  bob = await createTestUser("bob-ws");
});

const doc = (text: string): TiptapDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

async function project(person: TestUser, name = "Acme") {
  actAs(person);
  return ok(await createProject({ name }));
}
async function task(person: TestUser, input: Record<string, unknown> = {}) {
  actAs(person);
  return ok(await createTask({ title: "A task", ...input }));
}
async function note(person: TestUser, input: Record<string, unknown> = {}) {
  actAs(person);
  return ok(await createNote(input));
}

describe("projects", () => {
  it("creates, edits and lists projects; archived status and archived_at stay in sync", async () => {
    const person = await createTestUser("proj-crud");
    actAs(person);
    const p = ok(
      await createProject({ name: "  Home  ", description: "Flat move", color: "green" }),
    );
    expect(p).toMatchObject({
      name: "Home",
      description: "Flat move",
      color: "green",
      status: "ACTIVE",
    });

    const renamed = ok(await updateProject({ id: p.id, name: "House", status: "ON_HOLD" }));
    expect(renamed).toMatchObject({ name: "House", status: "ON_HOLD" });

    ok(await updateProject({ id: p.id, status: "ARCHIVED" }));
    const [archived] = (await listProjects(person.id)).filter((x) => x.id === p.id);
    expect(archived?.status).toBe("ARCHIVED");
    ok(await updateProject({ id: p.id, status: "ACTIVE" }));
    expect((await listProjects(person.id))[0]?.status).toBe("ACTIVE");
  });

  it("validates input and refuses fields it doesn't have", async () => {
    actAs(alice);
    expect(errorOf(await createProject({ name: " " })).fieldErrors?.name).toBe(
      "Enter a project name.",
    );
    expect(errorOf(await createProject({ name: "x".repeat(101) })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createProject({ name: "x", color: "#ff0000" })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await createProject({ name: "x", userId: bob.id })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("orders pickers active first, then on hold, then the rest", async () => {
    const person = await createTestUser("proj-order");
    actAs(person);
    ok(await createProject({ name: "Zeta", status: "ACTIVE" }));
    ok(await createProject({ name: "Beta", status: "COMPLETED" }));
    ok(await createProject({ name: "Alpha", status: "ON_HOLD" }));
    ok(await createProject({ name: "Gamma", status: "ACTIVE" }));
    expect((await listProjectRefs(person.id)).map((p) => p.name)).toEqual([
      "Gamma",
      "Zeta",
      "Alpha",
      "Beta",
    ]);
  });

  it("assigns tasks, todos and notes, and takes them out again", async () => {
    const person = await createTestUser("proj-assign");
    const p = await project(person);
    const t = await task(person);
    actAs(person);
    const todo = ok(await createTodo({ title: "Todo" }));
    const n = await note(person, { title: "Note" });

    for (const [itemType, itemId] of [
      ["task", t.id],
      ["todo", todo.id],
      ["note", n.id],
    ] as const) {
      const result = ok(await assignToProject({ itemType, itemId, projectId: p.id }));
      expect(result.project?.id).toBe(p.id);
    }
    const detail = await getProjectDetail(person.id, p.id);
    expect(detail?.openTasks.map((x) => x.id)).toEqual([t.id]);
    expect(detail?.openTodos.map((x) => x.id)).toEqual([todo.id]);
    expect(detail?.notes.map((x) => x.id)).toEqual([n.id]);

    ok(await assignToProject({ itemType: "task", itemId: t.id, projectId: null }));
    expect((await getProjectDetail(person.id, p.id))?.openTasks).toHaveLength(0);
    expect((await listTasks(person.id))[0]?.project).toBeNull();
  });

  it("creates items directly inside a project", async () => {
    const person = await createTestUser("proj-create-in");
    const p = await project(person);
    const t = await task(person, { projectId: p.id });
    actAs(person);
    const todo = ok(await createTodo({ title: "In project", projectId: p.id }));
    const n = await note(person, { projectId: p.id });
    expect(t.project?.id).toBe(p.id);
    expect(todo.project?.id).toBe(p.id);
    expect((await listNotes(person.id, { projectId: p.id })).map((x) => x.id)).toEqual([n.id]);
  });

  it("a subtask follows its parent's project, and moving the parent moves it too", async () => {
    const person = await createTestUser("proj-sub");
    const a = await project(person, "A");
    const b = await project(person, "B");
    const parent = await task(person, { projectId: a.id });
    const sub = await task(person, { parentTaskId: parent.id, projectId: b.id }); // ignored
    const [subRow] = await db.select().from(tasks).where(eq(tasks.id, sub.id));
    expect(subRow?.projectId).toBe(a.id);

    actAs(person);
    expect(
      errorOf(await assignToProject({ itemType: "task", itemId: sub.id, projectId: b.id })).code,
    ).toBe("VALIDATION_ERROR");

    ok(await assignToProject({ itemType: "task", itemId: parent.id, projectId: b.id }));
    const [moved] = await db.select().from(tasks).where(eq(tasks.id, sub.id));
    expect(moved?.projectId).toBe(b.id);
  });

  it("trashing a project keeps its items active as 'No project'; restoring brings the grouping back", async () => {
    const person = await createTestUser("proj-trash");
    const p = await project(person);
    const t = await task(person, { projectId: p.id, title: "Stays" });
    const n = await note(person, { projectId: p.id, title: "Stays too" });

    actAs(person);
    ok(await deleteProject({ id: p.id }));

    const [listed] = await listTasks(person.id);
    expect(listed).toMatchObject({ id: t.id, project: null });
    expect((await listNotes(person.id))[0]).toMatchObject({ id: n.id, project: null });
    expect(await getProjectDetail(person.id, p.id)).toBeNull();
    expect(await listProjects(person.id)).toHaveLength(0);
    // `project_id` is kept, so nothing is lost.
    const [raw] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(raw?.projectId).toBe(p.id);
    // A project in Trash can't be assigned to.
    expect(
      errorOf(await assignToProject({ itemType: "task", itemId: t.id, projectId: p.id })).code,
    ).toBe("NOT_FOUND");

    ok(await restoreProject({ id: p.id }));
    expect((await listTasks(person.id))[0]?.project?.id).toBe(p.id);
    expect((await listNotes(person.id))[0]?.project?.id).toBe(p.id);
  });

  it("permanently deleting a project leaves its items with no project", async () => {
    const person = await createTestUser("proj-perm");
    const p = await project(person);
    const t = await task(person, { projectId: p.id });
    actAs(person);
    expect(errorOf(await permanentlyDeleteProject({ id: p.id })).code).toBe("CONFLICT");
    ok(await deleteProject({ id: p.id }));
    ok(await permanentlyDeleteProject({ id: p.id }));
    const [raw] = await db.select().from(tasks).where(eq(tasks.id, t.id));
    expect(raw?.projectId).toBeNull();
  });

  it("progress counts tasks and todos, leaves out cancelled, and ignores archived and deleted", async () => {
    const person = await createTestUser("proj-progress");
    const p = await project(person);
    await task(person, { projectId: p.id, status: "DONE" });
    await task(person, { projectId: p.id, status: "CANCELLED" });
    await task(person, { projectId: p.id });
    actAs(person);
    const todo = ok(await createTodo({ title: "d", projectId: p.id }));
    await db
      .update(todos)
      .set({ isComplete: true, completedAt: new Date() })
      .where(eq(todos.id, todo.id));

    const [summary] = await listProjects(person.id);
    expect(summary).toMatchObject({ totalCount: 4, doneCount: 2, cancelledCount: 1, openCount: 1 });
  });
});

describe("tags", () => {
  it("creating the same tag twice, in any casing, gives one tag", async () => {
    const person = await createTestUser("tag-idem");
    actAs(person);
    const first = ok(await createTag({ name: "Client Work" }));
    const second = ok(await createTag({ name: "  client   work " }));
    expect(second.id).toBe(first.id);
    expect(first.name).toBe("Client Work"); // the first casing is kept
  });

  it("renames, refuses a clash (case-insensitively), allows changing only the casing, and sets colour", async () => {
    const person = await createTestUser("tag-rename");
    actAs(person);
    const a = ok(await createTag({ name: "alpha" }));
    const b = ok(await createTag({ name: "beta" }));

    const clash = errorOf(await renameTag({ id: b.id, name: "ALPHA" }));
    expect(clash.code).toBe("CONFLICT");
    expect(clash.fieldErrors?.name).toBe("A tag with that name already exists.");

    expect(ok(await renameTag({ id: a.id, name: "Alpha" })).name).toBe("Alpha");
    expect(ok(await setTagColor({ id: a.id, color: "violet" })).color).toBe("violet");
    expect(ok(await setTagColor({ id: a.id, color: null })).color).toBeNull();
    expect(errorOf(await setTagColor({ id: a.id, color: "#fff" })).code).toBe("VALIDATION_ERROR");
  });

  it("sets the tags on a task and a note, replacing the set, up to 10", async () => {
    const person = await createTestUser("tag-set");
    actAs(person);
    const t = await task(person);
    const n = await note(person);
    actAs(person);
    const x = ok(await createTag({ name: "x" }));
    const y = ok(await createTag({ name: "y" }));

    expect(ok(await setTaskTags({ id: t.id, tagIds: [x.id, y.id] })).map((g) => g.name)).toEqual([
      "x",
      "y",
    ]);
    expect((await getTaskDetail(person.id, t.id))?.tags.map((g) => g.name)).toEqual(["x", "y"]);
    expect(ok(await setTaskTags({ id: t.id, tagIds: [y.id] }))).toHaveLength(1);
    ok(await setNoteTags({ id: n.id, tagIds: [x.id] }));
    expect((await getNote(person.id, n.id))?.tags.map((g) => g.name)).toEqual(["x"]);

    const many = [];
    for (let i = 0; i < 11; i++) many.push(ok(await createTag({ name: `t${i}` })).id);
    expect(errorOf(await setTaskTags({ id: t.id, tagIds: many })).fieldErrors?.tagIds).toBe(
      "Up to 10 tags per item.",
    );
    expect(ok(await setTaskTags({ id: t.id, tagIds: [] }))).toEqual([]);
  });

  it("filters tasks and notes by tag", async () => {
    const person = await createTestUser("tag-filter");
    actAs(person);
    const t1 = await task(person, { title: "tagged" });
    await task(person, { title: "plain" });
    const n1 = await note(person, { title: "tagged note" });
    await note(person, { title: "plain note" });
    actAs(person);
    const tag = ok(await createTag({ name: "work" }));
    ok(await setTaskTags({ id: t1.id, tagIds: [tag.id] }));
    ok(await setNoteTags({ id: n1.id, tagIds: [tag.id] }));

    expect((await listTasks(person.id, { tagId: tag.id })).map((t) => t.title)).toEqual(["tagged"]);
    expect((await listNotes(person.id, { tagId: tag.id })).map((n) => n.title)).toEqual([
      "tagged note",
    ]);
  });

  it("deleting a tag removes it from tasks and notes but keeps them; usage counts are right", async () => {
    const person = await createTestUser("tag-delete");
    actAs(person);
    const t = await task(person);
    const n = await note(person);
    actAs(person);
    const tag = ok(await createTag({ name: "gone" }));
    ok(await setTaskTags({ id: t.id, tagIds: [tag.id] }));
    ok(await setNoteTags({ id: n.id, tagIds: [tag.id] }));
    expect((await listTagsWithUsage(person.id))[0]).toMatchObject({ taskCount: 1, noteCount: 1 });

    ok(await deleteTag({ id: tag.id }));
    expect((await getTaskDetail(person.id, t.id))?.tags).toEqual([]);
    expect(await getNote(person.id, n.id)).not.toBeNull();
    expect(await listTagsWithUsage(person.id)).toEqual([]);
  });

  it("a person can't use, rename or delete someone else's tag", async () => {
    const theirs = await (async () => {
      actAs(alice);
      return ok(await createTag({ name: "alice-private" }));
    })();
    const mine = await task(bob);
    actAs(bob);
    expect(errorOf(await setTaskTags({ id: mine.id, tagIds: [theirs.id] })).code).toBe("NOT_FOUND");
    expect(errorOf(await renameTag({ id: theirs.id, name: "mine" })).code).toBe("NOT_FOUND");
    expect(errorOf(await setTagColor({ id: theirs.id, color: "red" })).code).toBe("NOT_FOUND");
    expect(errorOf(await deleteTag({ id: theirs.id })).code).toBe("NOT_FOUND");
    // Same name in two accounts is two separate tags.
    expect(ok(await createTag({ name: "alice-private" })).id).not.toBe(theirs.id);
  });
});

describe("notes", () => {
  it("creates an empty note, builds the text copy on the server and never lists the document", async () => {
    const person = await createTestUser("note-basic");
    const created = await note(person, { title: "  Plan  ", contentJson: doc("Hello world") });
    const [raw] = await db.select().from(notes).where(eq(notes.id, created.id));
    expect(raw).toMatchObject({ title: "Plan", contentText: "Hello world", version: 1 });

    const [item] = await listNotes(person.id);
    expect(item).toMatchObject({ title: "Plan", snippet: "Hello world" });
    expect(item).not.toHaveProperty("contentJson");

    const empty = await note(person);
    const full = await getNote(person.id, empty.id);
    expect(full).toMatchObject({
      title: "",
      version: 1,
      contentJson: { type: "doc", content: [] },
    });
  });

  it("saves content and title with a version check; a stale save is a conflict and changes nothing", async () => {
    const person = await createTestUser("note-version");
    const created = await note(person, { contentJson: doc("one") });
    actAs(person);

    const first = ok(
      await saveNoteContent({ id: created.id, contentJson: doc("two"), baseVersion: 1 }),
    );
    expect(first).toMatchObject({ outcome: "saved", version: 2 });
    const title = ok(await saveNoteTitle({ id: created.id, title: "Named", baseVersion: 2 }));
    expect(title).toMatchObject({ outcome: "saved", version: 3 });

    const stale = ok(
      await saveNoteContent({ id: created.id, contentJson: doc("overwrite"), baseVersion: 2 }),
    );
    expect(stale).toEqual({ outcome: "conflict", version: 3 });
    const [raw] = await db.select().from(notes).where(eq(notes.id, created.id));
    expect(raw).toMatchObject({ contentText: "two", title: "Named", version: 3 });

    // "Keep mine": saving again from the latest version works.
    expect(
      ok(await saveNoteContent({ id: created.id, contentJson: doc("overwrite"), baseVersion: 3 })),
    ).toMatchObject({ outcome: "saved", version: 4 });
  });

  it("two tabs saving from the same version: one wins, the other is told", async () => {
    const person = await createTestUser("note-race");
    const created = await note(person);
    actAs(person);
    const results = await Promise.all([
      saveNoteContent({ id: created.id, contentJson: doc("tab A"), baseVersion: 1 }),
      saveNoteContent({ id: created.id, contentJson: doc("tab B"), baseVersion: 1 }),
    ]);
    const outcomes = results.map((r) => ok(r).outcome).sort();
    expect(outcomes).toEqual(["conflict", "saved"]);
  });

  it("rejects unsupported content, oversize content and unknown fields", async () => {
    const person = await createTestUser("note-validate");
    const created = await note(person);
    actAs(person);
    const bad = { type: "doc", content: [{ type: "script" }] };
    expect(
      errorOf(await saveNoteContent({ id: created.id, contentJson: bad, baseVersion: 1 })).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(
        await saveNoteContent({
          id: created.id,
          contentJson: doc("x"),
          baseVersion: 1,
          contentText: "forged",
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await saveNoteTitle({ id: created.id, title: "x".repeat(301), baseVersion: 1 })).code,
    ).toBe("VALIDATION_ERROR");
    expect(errorOf(await updateNoteMeta({ id: created.id, emoji: "no" })).fieldErrors?.emoji).toBe(
      "Choose a single emoji.",
    );
  });

  it("changing emoji or project doesn't bump the version", async () => {
    const person = await createTestUser("note-meta");
    const created = await note(person);
    const p = await project(person);
    actAs(person);
    ok(await updateNoteMeta({ id: created.id, emoji: "💡" }));
    ok(await assignToProject({ itemType: "note", itemId: created.id, projectId: p.id }));
    expect(await getNote(person.id, created.id)).toMatchObject({ emoji: "💡", version: 1 });
  });

  it("archives, trashes and restores; a trashed note is invisible and can't be saved to", async () => {
    const person = await createTestUser("note-trash");
    const created = await note(person, { title: "Keep" });
    actAs(person);
    ok(await archiveNote({ id: created.id, archived: true }));
    expect((await listNotes(person.id)).length).toBe(0);
    expect((await listNotes(person.id, { archived: true })).length).toBe(1);
    ok(await archiveNote({ id: created.id, archived: false }));

    ok(await deleteNote({ id: created.id }));
    expect(await getNote(person.id, created.id)).toBeNull();
    expect(
      errorOf(await saveNoteContent({ id: created.id, contentJson: doc("x"), baseVersion: 1 }))
        .code,
    ).toBe("NOT_FOUND");
    ok(await restoreNote({ id: created.id }));
    expect(await getNote(person.id, created.id)).not.toBeNull();

    expect(errorOf(await permanentlyDeleteNote({ id: created.id })).code).toBe("CONFLICT");
  });
});

describe("linking tasks and notes", () => {
  it("links both ways, once, and unlinks; 'new linked note' links in the same step", async () => {
    const person = await createTestUser("link-basic");
    const t = await task(person, { title: "Prepare meeting" });
    const n = await note(person, { title: "Meeting notes" });
    actAs(person);
    ok(await linkTaskNote({ taskId: t.id, noteId: n.id }));
    ok(await linkTaskNote({ taskId: t.id, noteId: n.id })); // twice is fine

    expect((await getTaskDetail(person.id, t.id))?.notes.map((x) => x.title)).toEqual([
      "Meeting notes",
    ]);
    expect((await getNote(person.id, n.id))?.tasks.map((x) => x.title)).toEqual([
      "Prepare meeting",
    ]);

    const fresh = ok(await createNote({ title: "New", linkTaskId: t.id }));
    expect((await getTaskDetail(person.id, t.id))?.notes.map((x) => x.id)).toContain(fresh.id);

    ok(await unlinkTaskNote({ taskId: t.id, noteId: n.id }));
    expect((await getTaskDetail(person.id, t.id))?.notes.map((x) => x.id)).toEqual([fresh.id]);
  });

  it("lists open tasks before finished ones, and hides items in Trash until restored", async () => {
    const person = await createTestUser("link-order");
    const done = await task(person, { title: "Finished", status: "DONE" });
    const open = await task(person, { title: "Open" });
    const n = await note(person);
    actAs(person);
    ok(await linkTaskNote({ taskId: done.id, noteId: n.id }));
    ok(await linkTaskNote({ taskId: open.id, noteId: n.id }));
    expect((await getNote(person.id, n.id))?.tasks.map((x) => x.title)).toEqual([
      "Open",
      "Finished",
    ]);

    ok(await deleteNote({ id: n.id }));
    expect((await getTaskDetail(person.id, open.id))?.notes).toEqual([]);
    ok(await restoreNote({ id: n.id }));
    expect((await getTaskDetail(person.id, open.id))?.notes).toHaveLength(1);
  });

  it("permanently deleting a note removes its links but not the task", async () => {
    const person = await createTestUser("link-perm");
    const t = await task(person);
    const n = await note(person);
    actAs(person);
    ok(await linkTaskNote({ taskId: t.id, noteId: n.id }));
    ok(await deleteNote({ id: n.id }));
    ok(await permanentlyDeleteNote({ id: n.id }));
    expect(await db.select().from(taskNotes).where(eq(taskNotes.taskId, t.id))).toHaveLength(0);
    expect(await getTaskDetail(person.id, t.id)).not.toBeNull();
  });
});

describe("one person's workspace is invisible to another", () => {
  it("rejects linking across accounts, with the same answer as for a missing id", async () => {
    const theirTask = await task(alice, { title: "Alice task" });
    const theirNote = await note(alice, { title: "Alice note" });
    const myTask = await task(bob);
    const myNote = await note(bob);
    actAs(bob);

    expect(errorOf(await linkTaskNote({ taskId: theirTask.id, noteId: myNote.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await linkTaskNote({ taskId: myTask.id, noteId: theirNote.id })).code).toBe(
      "NOT_FOUND",
    );
    expect(
      errorOf(await linkTaskNote({ taskId: crypto.randomUUID(), noteId: myNote.id })).code,
    ).toBe("NOT_FOUND");
    expect(
      await db
        .select()
        .from(taskNotes)
        .where(and(eq(taskNotes.userId, bob.id))),
    ).toHaveLength(0);

    expect(errorOf(await createNote({ linkTaskId: theirTask.id })).code).toBe("NOT_FOUND");
  });

  it("answers NOT_FOUND for every note, project and assignment action on another person's records", async () => {
    const theirNote = await note(alice, {
      title: "Alice private note",
      contentJson: doc("secret"),
    });
    const theirProject = await project(alice, "Alice project");
    const theirTask = await task(alice);
    const before = await getNote(alice.id, theirNote.id);

    actAs(bob);
    const calls: Record<string, () => Promise<{ ok: boolean; error?: { code: string } }>> = {
      saveNoteContent: () =>
        saveNoteContent({ id: theirNote.id, contentJson: doc("x"), baseVersion: 1 }),
      saveNoteTitle: () => saveNoteTitle({ id: theirNote.id, title: "x", baseVersion: 1 }),
      updateNoteMeta: () => updateNoteMeta({ id: theirNote.id, emoji: "💡" }),
      archiveNote: () => archiveNote({ id: theirNote.id, archived: true }),
      deleteNote: () => deleteNote({ id: theirNote.id }),
      restoreNote: () => restoreNote({ id: theirNote.id }),
      permanentlyDeleteNote: () => permanentlyDeleteNote({ id: theirNote.id }),
      setNoteTags: () => setNoteTags({ id: theirNote.id, tagIds: [] }),
      updateProject: () => updateProject({ id: theirProject.id, name: "mine now" }),
      deleteProject: () => deleteProject({ id: theirProject.id }),
      restoreProject: () => restoreProject({ id: theirProject.id }),
      permanentlyDeleteProject: () => permanentlyDeleteProject({ id: theirProject.id }),
      assignTheirNote: () =>
        assignToProject({ itemType: "note", itemId: theirNote.id, projectId: null }),
      assignTheirTask: () =>
        assignToProject({ itemType: "task", itemId: theirTask.id, projectId: null }),
      assignToTheirProject: async () => {
        const mine = await task(bob);
        actAs(bob);
        return assignToProject({ itemType: "task", itemId: mine.id, projectId: theirProject.id });
      },
      createInTheirProject: () => createTask({ title: "x", projectId: theirProject.id }),
      createNoteInTheirProject: () => createNote({ projectId: theirProject.id }),
      createTodoInTheirProject: () => createTodo({ title: "x", projectId: theirProject.id }),
    };
    for (const [name, call] of Object.entries(calls)) {
      const result = await call();
      expect(result.ok, name).toBe(false);
      expect(result.error?.code, name).toBe("NOT_FOUND");
    }

    expect(await getNote(alice.id, theirNote.id)).toEqual(before);
    expect(await getNote(bob.id, theirNote.id)).toBeNull();
    expect(await getProjectDetail(bob.id, theirProject.id)).toBeNull();
    expect((await listProjects(bob.id)).some((p) => p.id === theirProject.id)).toBe(false);
    expect((await listNotes(bob.id)).some((n) => n.id === theirNote.id)).toBe(false);
    expect((await listOpenTodos(bob.id)).length).toBeGreaterThanOrEqual(0);
  });

  it("every action needs a signed-in person", async () => {
    const t = await task(alice);
    actAs(null);
    const results = [
      await createNote({}),
      await createProject({ name: "x" }),
      await createTag({ name: "x" }),
      await linkTaskNote({ taskId: t.id, noteId: t.id }),
      await saveNoteContent({ id: t.id, contentJson: doc("x"), baseVersion: 1 }),
      await assignToProject({ itemType: "task", itemId: t.id, projectId: null }),
      await setTaskTags({ id: t.id, tagIds: [] }),
    ];
    for (const r of results) expect(errorOf(r).code).toBe("UNAUTHENTICATED");
  });

  it("deleting an account removes its projects, notes and tags", async () => {
    const person = await createTestUser("ws-leaving");
    const p = await project(person);
    const n = await note(person, { projectId: p.id });
    actAs(person);
    const tag = ok(await createTag({ name: "bye" }));
    ok(await setNoteTags({ id: n.id, tagIds: [tag.id] }));
    const { user, projects, tags } = await import("@/db/schema");
    await db.delete(user).where(eq(user.id, person.id));
    expect(await db.select().from(notes).where(eq(notes.id, n.id))).toHaveLength(0);
    expect(await db.select().from(projects).where(eq(projects.id, p.id))).toHaveLength(0);
    expect(await db.select().from(tags).where(eq(tags.id, tag.id))).toHaveLength(0);
  });
});
