import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  archiveTodo,
  createTodo,
  deleteTodo,
  permanentlyDeleteTodo,
  reorderTodo,
  restoreTodo,
  setTodoComplete,
  updateTodo,
} from "@/actions/todos";
import { db } from "@/db/client";
import { listCompletedTodosSince, listOpenTodos } from "@/db/queries/todos";
import { todos } from "@/db/schema";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-todos");
  bob = await createTestUser("bob-todos");
});

async function make(person: TestUser, input: Record<string, unknown> = {}) {
  actAs(person);
  return ok(await createTodo({ title: "A todo", ...input }));
}

async function row(id: string) {
  const [r] = await db.select().from(todos).where(eq(todos.id, id));
  return r!;
}

describe("creating and listing", () => {
  it("creates a todo, newest on top", async () => {
    const person = await createTestUser("order-todos");
    const first = await make(person, { title: "First" });
    const second = await make(person, { title: "Second", emoji: "🌱", dueDate: "2026-10-03" });

    expect(second).toMatchObject({
      title: "Second",
      emoji: "🌱",
      dueDate: "2026-10-03",
      isComplete: false,
    });
    expect(second.sortOrder).toBeLessThan(first.sortOrder);
    expect((await listOpenTodos(person.id)).map((t) => t.title)).toEqual(["Second", "First"]);
  });

  it("validates title, emoji and date, and rejects fields todos don't have", async () => {
    actAs(alice);
    expect(errorOf(await createTodo({ title: " " })).fieldErrors?.title).toBe("Enter a title.");
    expect(errorOf(await createTodo({ title: "x".repeat(301) })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createTodo({ title: "x", emoji: "nope" })).fieldErrors?.emoji).toBe(
      "Choose a single emoji.",
    );
    expect(errorOf(await createTodo({ title: "x", dueDate: "2026-13-01" })).code).toBe(
      "VALIDATION_ERROR",
    );
    // Todos have no priority, tags, description or owner field.
    for (const extra of [
      { priority: "HIGH" },
      { description: "x" },
      { tags: [] },
      { userId: bob.id },
    ]) {
      expect(errorOf(await createTodo({ title: "x", ...extra })).code, JSON.stringify(extra)).toBe(
        "VALIDATION_ERROR",
      );
    }
  });

  it("only accepts a project that is the person's own", async () => {
    actAs(alice);
    expect(errorOf(await createTodo({ title: "x", projectId: crypto.randomUUID() })).code).toBe(
      "NOT_FOUND",
    );
  });

  it("requires a signed-in person", async () => {
    actAs(null);
    expect(errorOf(await createTodo({ title: "x" })).code).toBe("UNAUTHENTICATED");
  });
});

describe("editing", () => {
  it("changes title, emoji and due date, and clears them", async () => {
    const todo = await make(alice);
    const updated = ok(
      await updateTodo({ id: todo.id, title: "Renamed", emoji: "☕", dueDate: "2026-10-09" }),
    );
    expect(updated).toMatchObject({ title: "Renamed", emoji: "☕", dueDate: "2026-10-09" });

    const cleared = ok(await updateTodo({ id: todo.id, emoji: null, dueDate: null }));
    expect(cleared).toMatchObject({ title: "Renamed", emoji: null, dueDate: null });
  });
});

describe("ticking off", () => {
  it("completes with a timestamp, reports the previous value, and can be undone", async () => {
    const todo = await make(alice);
    const done = ok(await setTodoComplete({ id: todo.id, isComplete: true }));
    expect(done.wasComplete).toBe(false);
    expect(done.todo.isComplete).toBe(true);
    expect(done.todo.completedAt).not.toBeNull();

    const undone = ok(await setTodoComplete({ id: todo.id, isComplete: false }));
    expect(undone.wasComplete).toBe(true);
    expect(undone.todo).toMatchObject({ isComplete: false, completedAt: null });
  });

  it("lists open todos and today's completed ones separately", async () => {
    const person = await createTestUser("lists-todos");
    const open = await make(person, { title: "Open" });
    const finished = await make(person, { title: "Finished" });
    ok(await setTodoComplete({ id: finished.id, isComplete: true }));

    expect((await listOpenTodos(person.id)).map((t) => t.id)).toEqual([open.id]);
    const hourAgo = new Date(Date.now() - 3_600_000);
    expect((await listCompletedTodosSince(person.id, hourAgo)).map((t) => t.id)).toEqual([
      finished.id,
    ]);
    expect(await listCompletedTodosSince(person.id, new Date(Date.now() + 3_600_000))).toEqual([]);
  });

  it("the database keeps isComplete and completedAt in step", async () => {
    await expect(
      db.insert(todos).values({ userId: alice.id, title: "Bad", isComplete: true, sortOrder: 0 }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(todos)
        .values({ userId: alice.id, title: "Bad", completedAt: new Date(), sortOrder: 0 }),
    ).rejects.toThrow();
  });
});

describe("manual order", () => {
  it("moves between neighbours, to the top, and to the bottom", async () => {
    const person = await createTestUser("move-todos");
    const a = await make(person, { title: "A" });
    const b = await make(person, { title: "B" });
    const c = await make(person, { title: "C" });
    const ids = async () => (await listOpenTodos(person.id)).map((t) => t.id);
    expect(await ids()).toEqual([c.id, b.id, a.id]);

    ok(await reorderTodo({ id: a.id, beforeId: c.id, afterId: b.id }));
    expect(await ids()).toEqual([c.id, a.id, b.id]);
    ok(await reorderTodo({ id: b.id, afterId: c.id }));
    expect(await ids()).toEqual([b.id, c.id, a.id]);
    ok(await reorderTodo({ id: b.id, beforeId: a.id }));
    expect(await ids()).toEqual([c.id, a.id, b.id]);
  });

  it("renumbers when there is no room left", async () => {
    const person = await createTestUser("renumber-todos");
    const a = await make(person, { title: "A" });
    const b = await make(person, { title: "B" });
    const c = await make(person, { title: "C" });
    await db.update(todos).set({ sortOrder: 1 }).where(eq(todos.id, b.id));
    await db
      .update(todos)
      .set({ sortOrder: 1 + 1e-12 })
      .where(eq(todos.id, a.id));
    await db.update(todos).set({ sortOrder: 0 }).where(eq(todos.id, c.id));

    ok(await reorderTodo({ id: c.id, beforeId: b.id, afterId: a.id }));
    expect((await listOpenTodos(person.id)).map((t) => t.id)).toEqual([b.id, c.id, a.id]);
  });
});

describe("archive, trash and restore", () => {
  it("archived todos leave the list", async () => {
    const person = await createTestUser("archive-todos");
    const todo = await make(person);
    ok(await archiveTodo({ id: todo.id }));
    expect(await listOpenTodos(person.id)).toEqual([]);
    expect((await listOpenTodos(person.id, { archived: true })).map((t) => t.id)).toEqual([
      todo.id,
    ]);
  });

  it("deleting moves it to Trash and restoring brings it back", async () => {
    const person = await createTestUser("trash-todos");
    const todo = await make(person);
    ok(await deleteTodo({ id: todo.id }));
    expect(await listOpenTodos(person.id)).toEqual([]);
    expect(errorOf(await updateTodo({ id: todo.id, title: "x" })).code).toBe("NOT_FOUND");

    ok(await restoreTodo({ id: todo.id }));
    expect((await listOpenTodos(person.id)).map((t) => t.id)).toEqual([todo.id]);
    expect(errorOf(await restoreTodo({ id: todo.id })).code).toBe("NOT_FOUND");
  });

  it("permanent deletion works only from Trash", async () => {
    const todo = await make(alice);
    expect(errorOf(await permanentlyDeleteTodo({ id: todo.id })).code).toBe("CONFLICT");
    ok(await deleteTodo({ id: todo.id }));
    ok(await permanentlyDeleteTodo({ id: todo.id }));
    expect(await db.select().from(todos).where(eq(todos.id, todo.id))).toHaveLength(0);
  });
});

describe("one person's todos are invisible to another", () => {
  const actions = {
    updateTodo: (id: string) => updateTodo({ id, title: "hacked" }),
    setTodoComplete: (id: string) => setTodoComplete({ id, isComplete: true }),
    reorderTodo: (id: string) => reorderTodo({ id }),
    archiveTodo: (id: string) => archiveTodo({ id }),
    deleteTodo: (id: string) => deleteTodo({ id }),
    restoreTodo: (id: string) => restoreTodo({ id }),
    permanentlyDeleteTodo: (id: string) => permanentlyDeleteTodo({ id }),
  };

  it("answers NOT_FOUND for every action, exactly as for an unknown id, and changes nothing", async () => {
    const todo = await make(alice, { title: "Alice's private todo" });
    const before = await row(todo.id);

    actAs(bob);
    for (const [name, call] of Object.entries(actions)) {
      expect(errorOf(await call(todo.id)).code, name).toBe("NOT_FOUND");
      expect(errorOf(await call(crypto.randomUUID())).code, `${name} (unknown id)`).toBe(
        "NOT_FOUND",
      );
    }
    expect(await row(todo.id)).toEqual(before);
  });

  it("can't order against someone else's todo", async () => {
    const theirs = await make(alice);
    const mine = await make(bob);
    actAs(bob);
    expect(errorOf(await reorderTodo({ id: mine.id, beforeId: theirs.id })).code).toBe("NOT_FOUND");
  });

  it("never lists another person's todos", async () => {
    const todo = await make(alice, { title: "Alice only" });
    expect((await listOpenTodos(bob.id)).some((t) => t.id === todo.id)).toBe(false);
  });

  it("every action needs a signed-in person", async () => {
    const todo = await make(alice);
    actAs(null);
    for (const [name, call] of Object.entries(actions)) {
      expect(errorOf(await call(todo.id)).code, name).toBe("UNAUTHENTICATED");
    }
  });
});
