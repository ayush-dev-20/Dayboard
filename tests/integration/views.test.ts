import { and, eq, isNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createNote, reorderNote } from "@/actions/notes";
import { createProject } from "@/actions/projects";
import { createTag } from "@/actions/tags";
import { createTask } from "@/actions/tasks";
import { createTodo } from "@/actions/todos";
import {
  createView,
  deleteView,
  duplicateView,
  reorderView,
  restoreView,
  updateView,
} from "@/actions/views";
import { db } from "@/db/client";
import { ensureDefaultViews, ensureGalleryView } from "@/db/mutations/views";
import {
  getViews,
  listNotesForViews,
  listTasksForViews,
  listTodosForViews,
} from "@/db/queries/views";
import { collectionViews, notes } from "@/db/schema";
import { defaultConfig } from "@/lib/views/defaults";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V2 feature 06 against the real actions and database: view CRUD and ownership, the one-view rule,
// defaults, and the item reads that feed the engine.

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-views");
  bob = await createTestUser("bob-views");
});

const board = () => defaultConfig("TASKS", "BOARD");
const live = (userId: string, collection: "TASKS" | "TODOS" | "NOTES") =>
  db
    .select()
    .from(collectionViews)
    .where(
      and(
        eq(collectionViews.userId, userId),
        eq(collectionViews.collection, collection),
        isNull(collectionViews.deletedAt),
      ),
    );

describe("defaults", () => {
  it("a person with no views gets one List view per collection, once", async () => {
    const person = await createTestUser("fresh-views");
    expect(await live(person.id, "TASKS")).toHaveLength(0);
    for (const collection of ["TASKS", "TODOS", "NOTES"] as const) {
      const views = await getViews(person.id, collection);
      expect(views).toHaveLength(1);
      expect(views[0]).toMatchObject({ type: "LIST", name: `All ${collection.toLowerCase()}` });
    }
    await ensureDefaultViews(person.id);
    await ensureDefaultViews(person.id);
    expect(await live(person.id, "TASKS")).toHaveLength(1);
  });

  it("the default configs are the ones the code defines", async () => {
    const [tasksView] = await getViews(alice.id, "TASKS");
    expect(tasksView?.config).toEqual(defaultConfig("TASKS", "LIST"));
  });

  it("asks for a Gallery on legacy notes?view=grid and makes only one", async () => {
    const person = await createTestUser("gallery-views");
    const first = await ensureGalleryView(person.id);
    const second = await ensureGalleryView(person.id);
    expect(first.type).toBe("GALLERY");
    expect(second.id).toBe(first.id);
    expect((await getViews(person.id, "NOTES")).map((v) => v.type)).toEqual(["LIST", "GALLERY"]);
  });
});

describe("create, update, duplicate", () => {
  it("creates a view at the end, or after a given one", async () => {
    actAs(alice);
    const [first] = await getViews(alice.id, "TASKS");
    const created = ok(
      await createView({
        collection: "TASKS",
        name: "Board by status",
        type: "BOARD",
        config: board(),
      }),
    );
    expect(created).toMatchObject({ name: "Board by status", type: "BOARD", version: 1 });
    expect(created.position).toBeGreaterThan(first!.position);

    const between = ok(
      await createView({
        collection: "TASKS",
        name: "Between",
        type: "TABLE",
        config: defaultConfig("TASKS", "TABLE"),
        afterId: first!.id,
      }),
    );
    const order = (await getViews(alice.id, "TASKS")).map((v) => v.name);
    expect(order.indexOf("Between")).toBe(order.indexOf(first!.name) + 1);
    expect(between.position).toBeGreaterThan(first!.position);
    expect(between.position).toBeLessThan(created.position);
  });

  it("accepts a client-supplied id once", async () => {
    actAs(alice);
    const id = "00000000-0000-7000-8000-00000000a001";
    ok(
      await createView({
        id,
        collection: "TODOS",
        name: "Mine",
        type: "LIST",
        config: defaultConfig("TODOS", "LIST"),
      }),
    );
    expect(
      errorOf(
        await createView({
          id,
          collection: "TODOS",
          name: "Again",
          type: "LIST",
          config: defaultConfig("TODOS", "LIST"),
        }),
      ).code,
    ).toBe("INTERNAL_ERROR");
  });

  it("refuses an invalid config, a wrong type, and keys it does not know", async () => {
    actAs(alice);
    const bad = {
      filters: [{ property: "colour", op: "is", value: "red" }],
      sorts: [],
      groupBy: null,
      hideEmptyGroups: false,
      visibleProperties: [],
      openIn: "panel",
    };
    expect(
      errorOf(await createView({ collection: "TASKS", name: "x", type: "LIST", config: bad })).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(
        await createView({
          collection: "NOTES",
          name: "x",
          type: "CALENDAR",
          config: defaultConfig("NOTES", "LIST"),
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
    expect(
      errorOf(
        await createView({
          collection: "TASKS",
          name: "x",
          type: "LIST",
          config: board(),
          userId: bob.id,
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
  });

  it("only lets filters name the person's own projects and tags", async () => {
    actAs(bob);
    const project = ok(await createProject({ name: "Bob's" }));
    const tag = ok(await createTag({ name: "bobs-tag" }));
    actAs(alice);
    const withProject = {
      ...board(),
      filters: [{ property: "project", op: "is", value: project.id }],
    };
    expect(
      errorOf(
        await createView({ collection: "TASKS", name: "x", type: "BOARD", config: withProject }),
      ).code,
    ).toBe("NOT_FOUND");
    const withTag = { ...board(), filters: [{ property: "tags", op: "isAnyOf", value: [tag.id] }] };
    expect(
      errorOf(await createView({ collection: "TASKS", name: "x", type: "BOARD", config: withTag }))
        .code,
    ).toBe("NOT_FOUND");
    const order = { ...board(), boardColumnOrder: { project: [project.id] } };
    expect(
      errorOf(await createView({ collection: "TASKS", name: "x", type: "BOARD", config: order }))
        .code,
    ).toBe("NOT_FOUND");

    const mine = ok(await createProject({ name: "Alice's" }));
    ok(
      await createView({
        collection: "TASKS",
        name: "Mine",
        type: "BOARD",
        config: { ...board(), filters: [{ property: "project", op: "is", value: mine.id }] },
      }),
    );
  });

  it("updates name, emoji and config, and bumps the version", async () => {
    actAs(alice);
    const view = ok(
      await createView({
        collection: "TASKS",
        name: "Before",
        type: "TABLE",
        config: defaultConfig("TASKS", "TABLE"),
      }),
    );
    const renamed = ok(await updateView({ id: view.id, name: "After", emoji: "📋" }));
    expect(renamed).toMatchObject({ name: "After", emoji: "📋", version: 2 });
    const config = {
      ...defaultConfig("TASKS", "TABLE"),
      sorts: [{ property: "dueDate", dir: "asc" as const }],
    };
    const changed = ok(await updateView({ id: view.id, config }));
    expect(changed.config.sorts).toEqual(config.sorts);
    expect(changed.version).toBe(3);
    // Nothing to change changes nothing.
    expect(ok(await updateView({ id: view.id })).version).toBe(3);
    expect(
      errorOf(await updateView({ id: view.id, config: { ...config, groupBy: "nope" } })).code,
    ).toBe("VALIDATION_ERROR");
    expect(errorOf(await updateView({ id: view.id, name: "  " })).code).toBe("VALIDATION_ERROR");
  });

  it("a config is checked against the view's own collection", async () => {
    actAs(alice);
    const notesView = ok(
      await createView({
        collection: "NOTES",
        name: "N",
        type: "TABLE",
        config: defaultConfig("NOTES", "TABLE"),
      }),
    );
    // `status` is a task property: not valid on a notes view.
    const config = {
      ...defaultConfig("NOTES", "TABLE"),
      filters: [{ property: "status", op: "is", value: "DONE" }],
    };
    expect(errorOf(await updateView({ id: notesView.id, config })).code).toBe("VALIDATION_ERROR");
  });

  it("duplicates a view next to the original", async () => {
    actAs(alice);
    const view = ok(
      await createView({ collection: "TASKS", name: "Original", type: "BOARD", config: board() }),
    );
    const copy = ok(await duplicateView({ id: view.id }));
    expect(copy).toMatchObject({ name: "Original copy", type: "BOARD", config: view.config });
    expect(copy.id).not.toBe(view.id);
    const names = (await getViews(alice.id, "TASKS")).map((v) => v.name);
    expect(names.indexOf("Original copy")).toBe(names.indexOf("Original") + 1);
  });

  it("allows up to twenty views in a collection", async () => {
    const person = await createTestUser("many-views");
    actAs(person);
    await getViews(person.id, "TODOS"); // the default makes one
    for (let i = 1; i < 20; i += 1) {
      ok(
        await createView({
          collection: "TODOS",
          name: `v${i}`,
          type: "LIST",
          config: defaultConfig("TODOS", "LIST"),
        }),
      );
    }
    expect(
      errorOf(
        await createView({
          collection: "TODOS",
          name: "one too many",
          type: "LIST",
          config: defaultConfig("TODOS", "LIST"),
        }),
      ).code,
    ).toBe("VALIDATION_ERROR");
  });
});

describe("order, delete, restore", () => {
  it("moves a tab between two others, and renumbers when there is no room", async () => {
    const person = await createTestUser("order-views");
    actAs(person);
    const [home] = await getViews(person.id, "TASKS");
    const a = ok(
      await createView({
        collection: "TASKS",
        name: "A",
        type: "LIST",
        config: defaultConfig("TASKS", "LIST"),
      }),
    );
    const b = ok(
      await createView({
        collection: "TASKS",
        name: "B",
        type: "LIST",
        config: defaultConfig("TASKS", "LIST"),
      }),
    );
    ok(await reorderView({ id: b.id, beforeId: home!.id, afterId: a.id }));
    expect((await getViews(person.id, "TASKS")).map((v) => v.name)).toEqual([home!.name, "B", "A"]);
    // To the very front, and to the very end.
    ok(await reorderView({ id: a.id, afterId: home!.id }));
    expect((await getViews(person.id, "TASKS")).map((v) => v.name)).toEqual(["A", home!.name, "B"]);
    ok(await reorderView({ id: a.id, beforeId: b.id }));
    expect((await getViews(person.id, "TASKS")).map((v) => v.name)).toEqual([home!.name, "B", "A"]);
    expect(errorOf(await reorderView({ id: a.id, beforeId: a.id })).code).toBe("VALIDATION_ERROR");

    // Squeezing again and again between the same two neighbours eventually renumbers; order holds.
    for (let i = 0; i < 60; i += 1) {
      ok(
        await reorderView({
          id: i % 2 === 0 ? a.id : b.id,
          beforeId: home!.id,
          afterId: i % 2 === 0 ? b.id : a.id,
        }),
      );
    }
    const names = (await getViews(person.id, "TASKS")).map((v) => v.name);
    expect(names[0]).toBe(home!.name);
    expect(new Set(names).size).toBe(3);
  });

  it("deletes softly, refuses to delete the last view, and restores", async () => {
    const person = await createTestUser("delete-views");
    actAs(person);
    const [only] = await getViews(person.id, "NOTES");
    expect(errorOf(await deleteView({ id: only!.id }))).toMatchObject({
      code: "VALIDATION_ERROR",
      message: "A collection needs at least one view.",
    });

    const extra = ok(
      await createView({
        collection: "NOTES",
        name: "Extra",
        type: "GALLERY",
        config: defaultConfig("NOTES", "GALLERY"),
      }),
    );
    ok(await deleteView({ id: extra.id }));
    expect((await getViews(person.id, "NOTES")).map((v) => v.name)).toEqual([only!.name]);
    // The row is kept as a tombstone, and the original is now the last one again.
    const [row] = await db.select().from(collectionViews).where(eq(collectionViews.id, extra.id));
    expect(row?.deletedAt).not.toBeNull();
    expect(errorOf(await deleteView({ id: only!.id })).code).toBe("VALIDATION_ERROR");

    ok(await restoreView({ id: extra.id }));
    expect((await getViews(person.id, "NOTES")).map((v) => v.name)).toEqual([only!.name, "Extra"]);
  });
});

describe("ownership", () => {
  it("another person's view is not found, for every action", async () => {
    actAs(alice);
    const mine = ok(
      await createView({ collection: "TASKS", name: "Private", type: "BOARD", config: board() }),
    );
    actAs(bob);
    expect(errorOf(await updateView({ id: mine.id, name: "Stolen" })).code).toBe("NOT_FOUND");
    expect(errorOf(await duplicateView({ id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await reorderView({ id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await deleteView({ id: mine.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await restoreView({ id: mine.id })).code).toBe("NOT_FOUND");
    expect((await getViews(bob.id, "TASKS")).map((v) => v.name)).not.toContain("Private");
    // Neither reordering around her view works.
    const [bobs] = await getViews(bob.id, "TASKS");
    expect(errorOf(await reorderView({ id: bobs!.id, beforeId: mine.id })).code).toBe("NOT_FOUND");
  });

  it("requires a signed-in person", async () => {
    actAs(null);
    expect(
      errorOf(await createView({ collection: "TASKS", name: "x", type: "LIST", config: board() }))
        .code,
    ).toBe("UNAUTHENTICATED");
  });

  it("a saved config that no longer passes the rules reads back as the type's default", async () => {
    const person = await createTestUser("reset-views");
    actAs(person);
    const view = ok(
      await createView({ collection: "TASKS", name: "Odd", type: "BOARD", config: board() }),
    );
    await db
      .update(collectionViews)
      .set({ config: { filters: [{ property: "gone", op: "is", value: 1 }] } as never })
      .where(eq(collectionViews.id, view.id));
    const [read] = (await getViews(person.id, "TASKS")).filter((v) => v.id === view.id);
    expect(read?.config).toEqual(defaultConfig("TASKS", "BOARD"));
  });
});

describe("the items views read", () => {
  it("tasks: open ones always, finished ones only when asked, archived ones only when asked, with counts", async () => {
    const person = await createTestUser("items-tasks");
    actAs(person);
    const project = ok(await createProject({ name: "P" }));
    const open = ok(await createTask({ title: "open", projectId: project.id }));
    const done = ok(await createTask({ title: "done", status: "DONE" }));
    ok(await createTask({ title: "sub", parentTaskId: open.id }));
    expect((await listTasksForViews(person.id)).map((t) => t.title)).toEqual(["open"]);
    const withClosed = await listTasksForViews(person.id, { includeClosed: true });
    expect(withClosed.map((t) => t.title).sort()).toEqual(["done", "open"]);
    expect(withClosed.find((t) => t.id === done.id)?.status).toBe("DONE");
    const first = withClosed.find((t) => t.id === open.id)!;
    expect(first).toMatchObject({ subtaskTotal: 1, noteCount: 0 });
    expect(first.project?.id).toBe(project.id);
    expect(await listTasksForViews(person.id, { archivedOnly: true })).toEqual([]);
    expect(
      (await listTasksForViews(person.id, { projectId: project.id })).map((t) => t.title),
    ).toEqual(["open"]);
  });

  it("tasks, todos and notes of another person never appear", async () => {
    actAs(bob);
    ok(await createTask({ title: "bob-task" }));
    ok(await createTodo({ title: "bob-todo" }));
    ok(await createNote({ title: "bob-note" }));
    const aliceTasks = (await listTasksForViews(alice.id, { includeClosed: true })).map(
      (t) => t.title,
    );
    expect(aliceTasks).not.toContain("bob-task");
    expect(
      (await listTodosForViews(alice.id, { includeClosed: true })).map((t) => t.title),
    ).not.toContain("bob-todo");
    expect((await listNotesForViews(alice.id)).map((n) => n.title)).not.toContain("bob-note");
  });

  it("todos: open, finished on request, project scope", async () => {
    const person = await createTestUser("items-todos");
    actAs(person);
    const project = ok(await createProject({ name: "T" }));
    ok(await createTodo({ title: "a", projectId: project.id }));
    ok(await createTodo({ title: "b" }));
    expect((await listTodosForViews(person.id)).map((t) => t.title).sort()).toEqual(["a", "b"]);
    expect(
      (await listTodosForViews(person.id, { projectId: project.id })).map((t) => t.title),
    ).toEqual(["a"]);
  });

  it("notes: manual order with the newest on top, linked counts, and no document", async () => {
    const person = await createTestUser("items-notes");
    actAs(person);
    const first = ok(await createNote({ title: "first" }));
    const second = ok(await createNote({ title: "second" }));
    const third = ok(await createNote({ title: "third" }));
    const list = await listNotesForViews(person.id);
    expect(list.map((n) => n.title)).toEqual(["third", "second", "first"]);
    expect(list[0]).not.toHaveProperty("contentJson");
    expect(list[0]).toMatchObject({ taskCount: 0, archived: false });

    // Arranging notes puts one between two others without touching when it was updated.
    const before = (await db.select().from(notes).where(eq(notes.id, first.id)))[0]!.updatedAt;
    ok(await reorderNote({ id: first.id, beforeId: third.id, afterId: second.id }));
    expect((await listNotesForViews(person.id)).map((n) => n.title)).toEqual([
      "third",
      "first",
      "second",
    ]);
    expect((await db.select().from(notes).where(eq(notes.id, first.id)))[0]!.updatedAt).toEqual(
      before,
    );
    ok(await reorderNote({ id: second.id, beforeId: third.id, afterId: first.id }));
    expect((await listNotesForViews(person.id)).map((n) => n.title)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("a note cannot be arranged by someone else, or next to someone else's", async () => {
    const mine = await createTestUser("note-owner");
    actAs(mine);
    const note = ok(await createNote({ title: "mine" }));
    actAs(bob);
    const theirs = ok(await createNote({ title: "theirs" }));
    expect(errorOf(await reorderNote({ id: note.id })).code).toBe("NOT_FOUND");
    expect(errorOf(await reorderNote({ id: theirs.id, beforeId: note.id })).code).toBe("NOT_FOUND");
  });
});
