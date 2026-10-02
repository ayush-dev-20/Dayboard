import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  archiveInboxItem,
  captureInboxItem,
  convertInboxItem,
  deleteInboxItem,
  permanentlyDeleteInboxItem,
  restoreInboxItem,
  unarchiveInboxItem,
  updateInboxItem,
} from "@/actions/inbox";
import { createNote, deleteNote } from "@/actions/notes";
import { createProject, deleteProject } from "@/actions/projects";
import { createTag, setNoteTags, setTaskTags } from "@/actions/tags";
import { completeTask, createTask, deleteTask, updateTask } from "@/actions/tasks";
import { setFocus } from "@/actions/today";
import { createTodo, deleteTodo } from "@/actions/todos";
import { emptyTrash, permanentlyDeleteTrashItem, restoreTrashItem } from "@/actions/trash";
import { db } from "@/db/client";
import { getInbox } from "@/db/queries/inbox";
import { getNavCounts } from "@/db/queries/nav-counts";
import { recentItems, searchWorkspace } from "@/db/queries/search";
import { getTodayData } from "@/db/queries/today";
import { listTrash, trashCounts } from "@/db/queries/trash";
import { inboxItems, notes, taskNotes, tasks, userPreferences } from "@/db/schema";
import { addDays } from "@/lib/dates/calendar";
import { getUserToday, type DayPrefs } from "@/lib/dates/today";
import { actAs, createTestUser, errorOf, ok, setPreferences, type TestUser } from "./harness";
import type { TiptapDoc } from "@/lib/editor/types";
import type { SearchParams } from "@/lib/search/types";

let alice: TestUser;
let bob: TestUser;
const prefs: DayPrefs = { timezone: "UTC", startOfDay: "06:00" };

beforeAll(async () => {
  alice = await createTestUser("alice-d4");
  bob = await createTestUser("bob-d4");
});

const doc = (text: string): TiptapDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const search = (userId: string, q: string, over: Partial<SearchParams> = {}) =>
  searchWorkspace(
    userId,
    { q, tab: "all", status: null, projectId: null, tagId: null, from: null, to: null, ...over },
    prefs,
    25,
  );
const capture = async (who: TestUser, text: string) => {
  actAs(who);
  return ok(await captureInboxItem({ text })).id;
};
const task = async (who: TestUser, input: Record<string, unknown>) => {
  actAs(who);
  return ok(await createTask({ title: "T", ...input }));
};

describe("inbox", () => {
  it("captures, validates, edits, archives, unarchives and soft-deletes", async () => {
    const person = await createTestUser("inbox-basic");
    actAs(person);
    expect(errorOf(await captureInboxItem({ text: "   " })).fieldErrors?.text).toBe(
      "Write something to capture.",
    );
    expect(errorOf(await captureInboxItem({ text: "x".repeat(5001) })).code).toBe(
      "VALIDATION_ERROR",
    );
    expect(errorOf(await captureInboxItem({ text: "x", userId: bob.id })).code).toBe(
      "VALIDATION_ERROR",
    );

    const id = await capture(person, "  Call the accountant  ");
    expect((await getInbox(person.id)).open.map((i) => i.text)).toEqual(["Call the accountant"]);

    ok(await updateInboxItem({ id, text: "Call the accountant tomorrow" }));
    ok(await archiveInboxItem({ id }));
    let inbox = await getInbox(person.id);
    expect(inbox.open).toHaveLength(0);
    expect(inbox.archived.map((i) => i.id)).toEqual([id]);
    ok(await unarchiveInboxItem({ id }));

    ok(await deleteInboxItem({ id }));
    expect((await getInbox(person.id)).open).toHaveLength(0);
    ok(await restoreInboxItem({ id }));
    expect((await getInbox(person.id)).open).toHaveLength(1);
    expect(errorOf(await permanentlyDeleteInboxItem({ id })).code).toBe("CONFLICT");
    inbox = await getInbox(person.id);
    expect(inbox.open[0]?.text).toBe("Call the accountant tomorrow");
  });

  it("lists newest first", async () => {
    const person = await createTestUser("inbox-order");
    await capture(person, "first");
    await new Promise((r) => setTimeout(r, 15));
    await capture(person, "second");
    expect((await getInbox(person.id)).open.map((i) => i.text)).toEqual(["second", "first"]);
  });

  it("converts to a task with the description, project and date, in one go", async () => {
    const person = await createTestUser("inbox-task");
    actAs(person);
    const project = ok(await createProject({ name: "Acme" }));
    const id = await capture(person, "Prepare call notes\nand send the agenda");
    const result = ok(
      await convertInboxItem({
        id,
        target: "task",
        title: "Prepare call notes",
        description: "and send the agenda",
        projectId: project.id,
        dueDate: "2026-10-05",
      }),
    );
    expect(result.refs).toHaveLength(1);
    const [row] = await db.select().from(tasks).where(eq(tasks.id, result.refs[0]!.id));
    expect(row).toMatchObject({
      title: "Prepare call notes",
      status: "PLANNED",
      dueDate: "2026-10-05",
      projectId: project.id,
    });
    expect(row?.descriptionText).toBe("and send the agenda");

    const inbox = await getInbox(person.id);
    expect(inbox.open).toHaveLength(0);
    expect(inbox.converted[0]?.converted).toMatchObject([
      { type: "task", title: "Prepare call notes" },
    ]);
  });

  it("'Decide later' keeps the task at Inbox status", async () => {
    const person = await createTestUser("inbox-later");
    const id = await capture(person, "Maybe look into this");
    const result = ok(
      await convertInboxItem({ id, target: "task", title: "Look into this", decideLater: true }),
    );
    const [row] = await db.select().from(tasks).where(eq(tasks.id, result.refs[0]!.id));
    expect(row?.status).toBe("INBOX");
  });

  it("converts to a todo, a note and a project idea", async () => {
    const person = await createTestUser("inbox-others");
    const todoItem = await capture(person, "Buy milk");
    const todo = ok(
      await convertInboxItem({
        id: todoItem,
        target: "todo",
        title: "Buy milk",
        dueDate: "2026-10-03",
      }),
    );
    expect(todo.refs[0]?.type).toBe("todo");

    const noteItem = await capture(person, "Standing desks\nUnder 30k, check reviews");
    const note = ok(
      await convertInboxItem({
        id: noteItem,
        target: "note",
        title: "Standing desks",
        body: "Standing desks\nUnder 30k, check reviews",
      }),
    );
    const [noteRow] = await db.select().from(notes).where(eq(notes.id, note.refs[0]!.id));
    expect(noteRow).toMatchObject({
      title: "Standing desks",
      contentText: "Standing desks\nUnder 30k, check reviews",
    });

    const projectItem = await capture(person, "Weekly review template\nfor the side project");
    const project = ok(
      await convertInboxItem({
        id: projectItem,
        target: "project",
        name: "Weekly review template",
        description: "for the side project",
      }),
    );
    const { projects } = await import("@/db/schema");
    const [projectRow] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.refs[0]!.id));
    expect(projectRow).toMatchObject({ status: "ON_HOLD", description: "for the side project" });

    const inbox = await getInbox(person.id);
    expect(inbox.converted).toHaveLength(3);
  });

  it("task + note creates both and links them", async () => {
    const person = await createTestUser("inbox-both");
    const id = await capture(person, "Send agenda to Meera before Friday");
    const result = ok(
      await convertInboxItem({
        id,
        target: "task_note",
        title: "Send agenda to Meera",
        body: "Send agenda to Meera before Friday",
      }),
    );
    expect(result.refs.map((r) => r.type)).toEqual(["task", "note"]);
    const links = await db.select().from(taskNotes).where(eq(taskNotes.userId, person.id));
    expect(links).toEqual([
      expect.objectContaining({ taskId: result.refs[0]!.id, noteId: result.refs[1]!.id }),
    ]);
  });

  it("is transactional: a failure part-way leaves nothing created and the item still open", async () => {
    const person = await createTestUser("inbox-tx");
    const id = await capture(person, "Will fail");
    // The note title fits the schema but the project doesn't exist, so the task + note step fails.
    const failed = await convertInboxItem({
      id,
      target: "task_note",
      title: "Will fail",
      body: "x",
      projectId: crypto.randomUUID(),
    });
    expect(errorOf(failed).code).toBe("NOT_FOUND");
    expect(await db.select().from(tasks).where(eq(tasks.userId, person.id))).toHaveLength(0);
    expect(await db.select().from(notes).where(eq(notes.userId, person.id))).toHaveLength(0);
    const [item] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
    expect(item?.status).toBe("OPEN");
  });

  it("can't convert twice, and refuses fields it doesn't know", async () => {
    const person = await createTestUser("inbox-twice");
    const id = await capture(person, "Once only");
    ok(await convertInboxItem({ id, target: "todo", title: "Once only" }));
    expect(errorOf(await convertInboxItem({ id, target: "todo", title: "Again" })).code).toBe(
      "CONFLICT",
    );
    const other = await capture(person, "x");
    expect(
      errorOf(await convertInboxItem({ id: other, target: "todo", title: "x", userId: bob.id }))
        .code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(await convertInboxItem({ id: other, target: "task", title: "" })).fieldErrors?.title,
    ).toBe("Enter a title.");
  });

  it("another person's inbox is invisible, and every action answers NOT_FOUND", async () => {
    const id = await capture(alice, "Alice private thought");
    actAs(bob);
    const calls = {
      update: () => updateInboxItem({ id, text: "hacked" }),
      convert: () => convertInboxItem({ id, target: "todo", title: "x" }),
      archive: () => archiveInboxItem({ id }),
      unarchive: () => unarchiveInboxItem({ id }),
      delete: () => deleteInboxItem({ id }),
      restore: () => restoreInboxItem({ id }),
      permanent: () => permanentlyDeleteInboxItem({ id }),
    };
    for (const [name, call] of Object.entries(calls))
      expect(errorOf(await call()).code, name).toBe("NOT_FOUND");
    expect((await getInbox(bob.id)).open.some((i) => i.id === id)).toBe(false);
    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
    expect(row).toMatchObject({ text: "Alice private thought", status: "OPEN", userId: alice.id });
  });

  it("every action needs a signed-in person", async () => {
    actAs(null);
    for (const r of [
      await captureInboxItem({ text: "x" }),
      await setFocus({ taskId: null }),
      await emptyTrash({}),
    ]) {
      expect(errorOf(r).code).toBe("UNAUTHENTICATED");
    }
  });
});

describe("today", () => {
  async function today(person: TestUser, p: DayPrefs = prefs, now = new Date()) {
    const row = (
      await db.select().from(userPreferences).where(eq(userPreferences.userId, person.id))
    )[0];
    return getTodayData(person.id, p, row?.focusTaskId ?? null, now);
  }

  it("puts overdue, today, timed, undated-priority, todos and completed items in the right sections", async () => {
    const person = await createTestUser("today-sections");
    const day = getUserToday(prefs);
    await task(person, { title: "Late", dueDate: addDays(day, -3) });
    await task(person, { title: "Due today", dueDate: day });
    await task(person, { title: "Later today", dueDate: day, dueTime: "23:59" });
    await task(person, { title: "Next week", dueDate: addDays(day, 7) });
    await task(person, { title: "Plan me", priority: "HIGH" });
    await task(person, { title: "Plan me too", priority: "MEDIUM" });
    await task(person, { title: "Low and undated", priority: "LOW" });
    await task(person, { title: "Waiting one", priority: "HIGH", status: "WAITING" });
    const done = await task(person, { title: "Finished" });
    actAs(person);
    ok(await completeTask({ id: done.id }));
    ok(await createTodo({ title: "Undated todo" }));
    ok(await createTodo({ title: "Due todo", dueDate: day }));
    ok(await createTodo({ title: "Future todo", dueDate: addDays(day, 5) }));
    ok(await createNote({ title: "Fresh note" }));

    const data = await today(person);
    expect(data.overdue.map((t) => t.title)).toEqual(["Late"]);
    // A timed task due later today is listed after the untimed ones.
    expect(data.today.map((t) => t.title)).toEqual(["Due today", "Later today"]);
    expect(data.laterStart).toBe(1);
    expect(data.planning.map((t) => t.title)).toEqual(["Plan me", "Plan me too"]);
    expect(data.todos.map((t) => t.title)).toEqual(["Due todo", "Undated todo"]);
    expect(data.notes.map((n) => n.title)).toEqual(["Fresh note"]);
    expect(data.completedTasks.map((t) => t.title)).toEqual(["Finished"]);
    expect(data.focus).toBeNull();
  });

  it("applies the limits and reports how many were overdue in all", async () => {
    const person = await createTestUser("today-limits");
    const day = getUserToday(prefs);
    for (let i = 0; i < 12; i++)
      await task(person, { title: `Overdue ${i}`, dueDate: addDays(day, -1) });
    const data = await today(person);
    expect(data.overdue).toHaveLength(10);
    expect(data.overdueTotal).toBe(12);
  });

  it("a task that went overdue earlier today (its time passed) is overdue, not today", async () => {
    const person = await createTestUser("today-timed");
    const day = getUserToday(prefs);
    await task(person, { title: "Earlier", dueDate: day, dueTime: "06:00" });
    const late = new Date(`${day}T20:00:00Z`);
    const data = await today(person, prefs, late);
    expect(data.overdue.map((t) => t.title)).toEqual(["Earlier"]);
    expect(data.today).toHaveLength(0);
  });

  it("focus: set, shown, and cleared on its own when completed, trashed, or someone else's", async () => {
    const person = await createTestUser("today-focus");
    const t = await task(person, { title: "Focus me", dueDate: getUserToday(prefs) });
    actAs(person);
    ok(await setFocus({ taskId: t.id }));
    expect((await today(person)).focus?.title).toBe("Focus me");

    ok(await completeTask({ id: t.id }));
    expect((await today(person)).focus).toBeNull();
    const [pref] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, person.id));
    expect(pref?.focusTaskId).toBeNull(); // cleared in the database too

    const other = await task(person, { title: "Second focus" });
    actAs(person);
    ok(await setFocus({ taskId: other.id }));
    ok(await deleteTask({ id: other.id }));
    expect((await today(person)).focus).toBeNull();

    ok(await setFocus({ taskId: null }));
    const theirs = await task(alice, { title: "Alice's task" });
    actAs(person);
    expect(errorOf(await setFocus({ taskId: theirs.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await setFocus({ taskId: crypto.randomUUID() })).code).toBe("NOT_FOUND");
  });

  it("only shows the person's own data", async () => {
    const day = getUserToday(prefs);
    await task(alice, { title: "Alice overdue secret", dueDate: addDays(day, -1) });
    const data = await today(bob);
    expect(JSON.stringify(data)).not.toContain("Alice overdue secret");
  });

  it("sidebar counts: tasks due or overdue, and open inbox items", async () => {
    const person = await createTestUser("today-counts");
    const day = getUserToday(prefs);
    await task(person, { title: "a", dueDate: addDays(day, -2) });
    await task(person, { title: "b", dueDate: day });
    await task(person, { title: "c", dueDate: addDays(day, 3) });
    await capture(person, "x");
    await capture(person, "y");
    expect(await getNavCounts(person.id, prefs)).toEqual({ today: 2, inbox: 2 });
  });
});

describe("search", () => {
  it("finds a task by description, a note by body, a project by name and a tag by name", async () => {
    const person = await createTestUser("search-basic");
    const t = await task(person, { title: "Plain title" });
    actAs(person);
    const noteResult = ok(
      await createNote({
        title: "Meeting",
        contentJson: doc("we should discuss the zebra crossing plan"),
      }),
    );
    ok(await createProject({ name: "Zebra rollout" }));
    const tag = ok(await createTag({ name: "zebra-tag" }));
    await db
      .update(tasks)
      .set({
        descriptionText: "needs a zebra budget",
        descriptionJson: doc("needs a zebra budget"),
      })
      .where(eq(tasks.id, t.id));
    ok(await setTaskTags({ id: t.id, tagIds: [tag.id] }));
    ok(await setNoteTags({ id: noteResult.id, tagIds: [tag.id] }));

    const r = await search(person.id, "zebra");
    expect(r.task.map((x) => x.title)).toEqual(["Plain title"]);
    expect(r.note.map((x) => x.title)).toEqual(["Meeting"]);
    expect(r.project.map((x) => x.title)).toEqual(["Zebra rollout"]);
    expect(r.tag.map((x) => x.title)).toEqual(["zebra-tag"]);
    expect(r.tag[0]).toMatchObject({ taskCount: 1, noteCount: 1 });
    // Snippets are plain text around the match.
    expect(r.note[0]?.snippet).toMatchObject({ match: "zebra" });
    const snippet = r.note[0]?.snippet;
    expect(`${snippet?.before}${snippet?.after}`).toContain("crossing");
  });

  it("ranks exact title, then prefix, then contains, then body, then newest", async () => {
    const person = await createTestUser("search-rank");
    await task(person, { title: "xx report" });
    await task(person, { title: "weekly report review" });
    await task(person, { title: "report" });
    await task(person, { title: "report writing" });
    const body = await task(person, { title: "Unrelated" });
    await db
      .update(tasks)
      .set({ descriptionText: "mentions the report here" })
      .where(eq(tasks.id, body.id));

    const titles = (await search(person.id, "report")).task.map((x) => x.title);
    expect(titles).toEqual(
      ["report", "report writing", "weekly report review", "xx report", "Unrelated"].sort(
        (a, b) => titles.indexOf(a) - titles.indexOf(b),
      ),
    );
    expect(titles[0]).toBe("report");
    expect(titles[1]).toBe("report writing");
    expect(titles.at(-1)).toBe("Unrelated");
  });

  it("treats %, _ and backslash literally", async () => {
    const person = await createTestUser("search-escape");
    await task(person, { title: "Save 50% today" });
    await task(person, { title: "Save 500 today" });
    await task(person, { title: "snake_case name" });
    await task(person, { title: "snakeXcase name" });
    await task(person, { title: "path C:\\temp" });
    expect((await search(person.id, "50%")).task.map((x) => x.title)).toEqual(["Save 50% today"]);
    expect((await search(person.id, "snake_case")).task.map((x) => x.title)).toEqual([
      "snake_case name",
    ]);
    expect((await search(person.id, "c:\\t")).task.map((x) => x.title)).toEqual(["path C:\\temp"]);
    expect((await search(person.id, "%%")).total).toBe(0);
  });

  it("includes archived items (labelled) but never ones in Trash", async () => {
    const person = await createTestUser("search-archive");
    const archived = await task(person, { title: "kiwi archived" });
    const trashed = await task(person, { title: "kiwi trashed" });
    await task(person, { title: "kiwi live" });
    await db.update(tasks).set({ archivedAt: new Date() }).where(eq(tasks.id, archived.id));
    actAs(person);
    ok(await deleteTask({ id: trashed.id }));
    const r = await search(person.id, "kiwi");
    expect(r.task.map((x) => [x.title, x.archived]).sort()).toEqual([
      ["kiwi archived", true],
      ["kiwi live", false],
    ]);
  });

  it("filters: status, project, tag, date range, and type", async () => {
    const person = await createTestUser("search-filters");
    actAs(person);
    const project = ok(await createProject({ name: "P" }));
    const tag = ok(await createTag({ name: "t" }));
    const a = await task(person, { title: "plum a", dueDate: "2026-10-01", projectId: project.id });
    await task(person, { title: "plum b", dueDate: "2026-11-01", status: "WAITING" });
    ok(await setTaskTags({ id: a.id, tagIds: [tag.id] }));
    actAs(person);
    ok(await createTodo({ title: "plum todo", dueDate: "2026-10-02" }));
    ok(await createNote({ title: "plum note" }));

    expect(
      (await search(person.id, "plum", { status: "WAITING" })).task.map((x) => x.title),
    ).toEqual(["plum b"]);
    expect((await search(person.id, "plum", { status: "WAITING" })).note).toEqual([]); // status = tasks only
    expect(
      (await search(person.id, "plum", { projectId: project.id })).task.map((x) => x.title),
    ).toEqual(["plum a"]);
    expect(
      (await search(person.id, "plum", { projectId: "none" })).task.map((x) => x.title),
    ).toEqual(["plum b"]);
    expect((await search(person.id, "plum", { tagId: tag.id })).task.map((x) => x.title)).toEqual([
      "plum a",
    ]);
    expect(
      (await search(person.id, "plum", { from: "2026-10-15", to: "2026-12-01" })).task.map(
        (x) => x.title,
      ),
    ).toEqual(["plum b"]);
    expect((await search(person.id, "plum", { tab: "todo" })).total).toBe(1);
    expect((await search(person.id, "plum", { tab: "note" })).note).toHaveLength(1);
    expect((await search(person.id, "plum", { tab: "task" })).note).toEqual([]);
  });

  it("one person's matching items never appear for another", async () => {
    actAs(alice);
    ok(await createNote({ title: "gooseberry plan", contentJson: doc("gooseberry body") }));
    ok(await createProject({ name: "gooseberry project" }));
    ok(await createTag({ name: "gooseberry" }));
    ok(await createTodo({ title: "gooseberry todo" }));
    await task(alice, { title: "gooseberry task" });
    const forBob = await search(bob.id, "gooseberry");
    expect(forBob.total).toBe(0);
    expect((await search(alice.id, "gooseberry")).total).toBe(5);
    expect(await recentItems(bob.id)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: "gooseberry plan" })]),
    );
  });

  it("recent items are the latest tasks and notes, newest first", async () => {
    const person = await createTestUser("search-recent");
    await task(person, { title: "older" });
    await new Promise((r) => setTimeout(r, 15));
    actAs(person);
    ok(await createNote({ title: "newest" }));
    const items = await recentItems(person.id);
    expect(items.map((i) => i.title)).toEqual(["newest", "older"]);
  });
});

describe("trash", () => {
  it("lists one of each type, newest deletion first, and counts them", async () => {
    const person = await createTestUser("trash-list");
    actAs(person);
    const t = await task(person, { title: "Trashed task" });
    const todo = ok(await createTodo({ title: "Trashed todo" }));
    const n = ok(await createNote({ title: "Trashed note" }));
    const p = ok(await createProject({ name: "Trashed project" }));
    const i = await capture(person, "Trashed inbox\nsecond line");
    actAs(person);
    for (const call of [
      () => deleteTask({ id: t.id }),
      () => deleteTodo({ id: todo.id }),
      () => deleteNote({ id: n.id }),
      () => deleteProject({ id: p.id }),
      () => deleteInboxItem({ id: i }),
    ]) {
      ok(await call());
      await new Promise((r) => setTimeout(r, 10));
    }
    const { items, next } = await listTrash(person.id);
    expect(items.map((x) => x.type)).toEqual(["inbox", "project", "note", "todo", "task"]);
    expect(items[0]?.title).toBe("Trashed inbox");
    expect(next).toBeNull();
    expect(await trashCounts(person.id)).toEqual({
      task: 1,
      todo: 1,
      note: 1,
      project: 1,
      inbox: 1,
      total: 5,
    });
    expect((await listTrash(person.id, { type: "note" })).items.map((x) => x.title)).toEqual([
      "Trashed note",
    ]);
  });

  it("a task deleted with its subtasks is one row; restoring brings the subtasks back", async () => {
    const person = await createTestUser("trash-subtasks");
    const parent = await task(person, { title: "Parent" });
    const sub = await task(person, { title: "Child", parentTaskId: parent.id });
    actAs(person);
    ok(await deleteTask({ id: parent.id }));
    const { items } = await listTrash(person.id);
    expect(items.map((x) => x.title)).toEqual(["Parent"]);

    ok(await restoreTrashItem({ type: "task", id: parent.id }));
    const [child] = await db.select().from(tasks).where(eq(tasks.id, sub.id));
    expect(child?.deletedAt).toBeNull();
    expect((await listTrash(person.id)).items).toHaveLength(0);
  });

  it("a subtask deleted on its own is listed itself", async () => {
    const person = await createTestUser("trash-lone-sub");
    const parent = await task(person, { title: "Alive parent" });
    const sub = await task(person, { title: "Lone child", parentTaskId: parent.id });
    actAs(person);
    ok(await deleteTask({ id: sub.id }));
    expect((await listTrash(person.id)).items.map((x) => x.title)).toEqual(["Lone child"]);
  });

  it("restore keeps the rules: a task whose project is still trashed shows no project", async () => {
    const person = await createTestUser("trash-restore-rules");
    actAs(person);
    const project = ok(await createProject({ name: "Gone project" }));
    const t = await task(person, { title: "In project", projectId: project.id });
    actAs(person);
    ok(await deleteTask({ id: t.id }));
    ok(await deleteProject({ id: project.id }));
    const restored = ok(await restoreTrashItem({ type: "task", id: t.id }));
    expect(restored.href).toBe(`/tasks?task=${t.id}`);
    const { listTasks } = await import("@/db/queries/tasks");
    expect((await listTasks(person.id))[0]).toMatchObject({ title: "In project", project: null });
  });

  it("deletes permanently only what is in Trash, and the data is really gone", async () => {
    const person = await createTestUser("trash-permanent");
    actAs(person);
    const n = ok(await createNote({ title: "Doomed" }));
    expect(errorOf(await permanentlyDeleteTrashItem({ type: "note", id: n.id })).code).toBe(
      "CONFLICT",
    );
    ok(await deleteNote({ id: n.id }));
    ok(await permanentlyDeleteTrashItem({ type: "note", id: n.id }));
    expect(await db.select().from(notes).where(eq(notes.id, n.id))).toHaveLength(0);
    expect(errorOf(await permanentlyDeleteTrashItem({ type: "note", id: n.id })).code).toBe(
      "NOT_FOUND",
    );
  });

  it("Empty trash removes everything in it (or one type), and only the person's own", async () => {
    const person = await createTestUser("trash-empty");
    const bobTask = await task(bob, { title: "Bob trashed" });
    actAs(bob);
    ok(await deleteTask({ id: bobTask.id }));
    const keep = await task(person, { title: "Keep me" });
    const gone = await task(person, { title: "Gone 1" });
    actAs(person);
    const note = ok(await createNote({ title: "Gone note" }));
    ok(await deleteTask({ id: gone.id }));
    ok(await deleteNote({ id: note.id }));

    expect(ok(await emptyTrash({ type: "note" })).deleted).toBe(1);
    expect((await trashCounts(person.id)).total).toBe(1);
    expect(ok(await emptyTrash({})).deleted).toBe(1);
    expect((await trashCounts(person.id)).total).toBe(0);
    const [kept] = await db.select().from(tasks).where(eq(tasks.id, keep.id));
    expect(kept?.title).toBe("Keep me");
    expect((await trashCounts(bob.id)).task).toBe(1); // Bob's own trash is untouched
  });

  it("another person's trash can't be restored, deleted or listed", async () => {
    const t = await task(alice, { title: "Alice trashed" });
    actAs(alice);
    ok(await deleteTask({ id: t.id }));
    actAs(bob);
    expect(errorOf(await restoreTrashItem({ type: "task", id: t.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await permanentlyDeleteTrashItem({ type: "task", id: t.id })).code).toBe(
      "NOT_FOUND",
    );
    expect((await listTrash(bob.id)).items.some((x) => x.id === t.id)).toBe(false);
    const [row] = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, t.id), eq(tasks.userId, alice.id)));
    expect(row?.deletedAt).not.toBeNull();
  });

  it("pages at 50 with a cursor", async () => {
    const person = await createTestUser("trash-page");
    const rows = Array.from({ length: 55 }, (_, i) => ({
      userId: person.id,
      title: `t${i}`,
      sortOrder: i,
      deletedAt: new Date(Date.now() - i * 1000),
    }));
    await db.insert(tasks).values(rows);
    const first = await listTrash(person.id);
    expect(first.items).toHaveLength(50);
    expect(first.next).not.toBeNull();
    const second = await listTrash(person.id, { cursor: first.next });
    expect(second.items).toHaveLength(5);
    expect(second.next).toBeNull();
    expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(55);
  });
});

it("updating a task's due date keeps the focus and counts consistent (sanity)", async () => {
  const person = await createTestUser("sanity");
  const t = await task(person, { title: "x" });
  actAs(person);
  ok(await updateTask({ id: t.id, dueDate: getUserToday(prefs) }));
  await setPreferences(person.id, { focusTaskId: t.id });
  expect((await getNavCounts(person.id, prefs)).today).toBe(1);
});
