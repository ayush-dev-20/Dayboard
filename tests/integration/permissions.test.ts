import { eq, inArray } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { canvases, notes, projects, resourceGrants, tasks, todos } from "@/db/schema";
import { uuidv7 } from "@/lib/ids";
import { accessibleWhere, can, requireAccess, resolveAccess } from "@/modules/permissions/access";
import { allowed, POLICY } from "@/modules/permissions/policy";
import { ACTIONS, type GrantRole, type ResourceType, type Role } from "@/modules/permissions/types";
import { createTestUser, type TestUser } from "./harness";

// V3 feature 04 against a real database: the ACL matrix generated from the policy table, inheritance (project grant,
// note grant, sub-notes, sub-tasks), what no grant can reach (journal entries, sticky notes, Trash), the highest role,
// grants that were not made by the owner, the lists, and that with sharing off only the owner has access.

const ON = { enabled: true } as const;
const OFF = { enabled: false } as const;

let owner: TestUser, editor: TestUser, commenter: TestUser, viewer: TestUser, stranger: TestUser;
let noteViewer: TestUser, noteEditor: TestUser, mixed: TestUser;

type Ids = Record<string, string>;
const id: Ids = {};

const doc = { type: "doc" as const, content: [] };
const grant = (
  resourceType: "PROJECT" | "NOTE",
  resourceId: string,
  grantee: TestUser,
  role: GrantRole,
  ownerId = owner.id,
) =>
  db
    .insert(resourceGrants)
    .values({ resourceType, resourceId, ownerId, granteeId: grantee.id, role });

beforeAll(async () => {
  const make = (n: string) => createTestUser(`acl-${n}`);
  owner = await make("owner");
  editor = await make("editor");
  commenter = await make("commenter");
  viewer = await make("viewer");
  stranger = await make("stranger");
  noteViewer = await make("note-viewer");
  noteEditor = await make("note-editor");
  mixed = await make("mixed");
  const [p] = await db
    .insert(projects)
    .values({ userId: owner.id, name: "Shared project" })
    .returning({ id: projects.id });
  const [p2] = await db
    .insert(projects)
    .values({ userId: owner.id, name: "Private project" })
    .returning({ id: projects.id });
  id.P = p!.id;
  id.P2 = p2!.id;

  const task = async (key: string, over: Record<string, unknown>) => {
    const [r] = await db
      .insert(tasks)
      .values({ userId: owner.id, title: key, sortOrder: 0, ...over })
      .returning({ id: tasks.id });
    id[key] = r!.id;
  };
  await task("T", { projectId: id.P });
  await task("Tsub", { projectId: id.P, parentTaskId: id.T });
  await task("Tp2", { projectId: id.P2 });
  await task("Tnone", {});
  await task("Ttrashed", { projectId: id.P, deletedAt: new Date() });
  const [cv] = await db
    .insert(canvases)
    .values({
      userId: owner.id,
      title: "c",
      sceneJson: { v: 1, elements: [], appState: {} } as never,
    })
    .returning({ id: canvases.id });
  await task("Sticky", { projectId: id.P, kind: "STICKY", stickyCanvasId: cv!.id });

  const todo = async (key: string, over: Record<string, unknown>) => {
    const [r] = await db
      .insert(todos)
      .values({ userId: owner.id, title: key, sortOrder: 0, ...over })
      .returning({ id: todos.id });
    id[key] = r!.id;
  };
  await todo("D", { projectId: id.P });
  await todo("Dp2", { projectId: id.P2 });

  const note = async (key: string, over: Record<string, unknown>) => {
    const [r] = await db
      .insert(notes)
      .values({ userId: owner.id, title: key, contentJson: doc, ...over })
      .returning({ id: notes.id });
    id[key] = r!.id;
  };
  await note("N1", { projectId: id.P });
  await note("N1a", { projectId: id.P, parentNoteId: id.N1, depth: 2 });
  await note("N2", {});
  await note("N2a", { parentNoteId: id.N2, depth: 2 });
  await note("N2aa", { parentNoteId: id.N2a, depth: 3 });
  await note("N3", {});
  await note("N3a", { parentNoteId: id.N3, depth: 2 });
  await note("Journal", { projectId: id.P, journalDate: "2026-11-14" });
  await note("Ntrashed", { projectId: id.P, deletedAt: new Date() });

  await grant("PROJECT", id.P!, editor, "EDITOR");
  await grant("PROJECT", id.P!, commenter, "COMMENTER");
  await grant("PROJECT", id.P!, viewer, "VIEWER");
  await grant("NOTE", id.N2!, noteViewer, "VIEWER");
  await grant("NOTE", id.N3a!, noteEditor, "EDITOR");
  // A person with a weak project grant and a stronger one on a note inside it: the highest role wins.
  await grant("PROJECT", id.P!, mixed, "VIEWER");
  await grant("NOTE", id.N1!, mixed, "COMMENTER");
});

// ---- The matrix, generated from the policy table ------------------------------------------------------------------

const ITEMS: { key: string; type: ResourceType }[] = [
  { key: "P", type: "PROJECT" },
  { key: "T", type: "TASK" },
  { key: "Tsub", type: "TASK" },
  { key: "D", type: "TODO" },
  { key: "N1", type: "NOTE" },
  { key: "N1a", type: "NOTE" },
];

describe("the ACL matrix", () => {
  const people: { name: string; who: () => TestUser; role: Role | null }[] = [
    { name: "owner", who: () => owner, role: "OWNER" },
    { name: "editor", who: () => editor, role: "EDITOR" },
    { name: "commenter", who: () => commenter, role: "COMMENTER" },
    { name: "viewer", who: () => viewer, role: "VIEWER" },
    { name: "stranger", who: () => stranger, role: null },
  ];

  for (const person of people) {
    it(`${person.name}: every action on every kind of item is exactly what the policy says`, async () => {
      const wrong: string[] = [];
      for (const item of ITEMS) {
        const access = await resolveAccess(person.who().id, item.type, id[item.key]!, ON);
        if (access.role !== person.role)
          wrong.push(`${item.key}: role ${access.role}, expected ${person.role}`);
        for (const action of ACTIONS) {
          const expected = allowed(person.role, item.type, action);
          let result: "allowed" | "NOT_FOUND" | "UNAUTHORIZED" | string;
          try {
            const got = await requireAccess(person.who().id, item.type, id[item.key]!, action, ON);
            result =
              got.ownerId === owner.id ? "allowed" : `allowed for the wrong owner ${got.ownerId}`;
          } catch (error) {
            result = (error as { code?: string }).code ?? String(error);
          }
          const want = person.role === null ? "NOT_FOUND" : expected ? "allowed" : "UNAUTHORIZED";
          if (result !== want) wrong.push(`${item.key} ${action}: ${result}, expected ${want}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }

  it("says the same NOT_FOUND for a stranger as for an id that does not exist", async () => {
    const real = await requireAccess(stranger.id, "NOTE", id.N1!, "read", ON).catch((e) => e);
    const missing = await requireAccess(stranger.id, "NOTE", uuidv7(), "read", ON).catch((e) => e);
    expect(real.code).toBe("NOT_FOUND");
    expect(missing.code).toBe("NOT_FOUND");
    expect(real.message).toBe(missing.message);
  });

  it("has a role for every policy cell the matrix exercises (a hole in POLICY fails here)", () => {
    for (const role of ["OWNER", "EDITOR", "COMMENTER", "VIEWER"] as const) {
      for (const item of ITEMS) {
        expect(Object.keys(POLICY[role][item.type]).sort()).toEqual([...ACTIONS].sort());
      }
    }
    expect(can({ role: "EDITOR", ownerId: owner.id }, "NOTE", "update")).toBe(true);
    expect(can({ role: null, ownerId: null }, "NOTE", "read")).toBe(false);
  });
});

// ---- Inheritance -------------------------------------------------------------------------------------------------

describe("what a grant reaches", () => {
  it("a project grant reaches the project, its tasks, sub-tasks, todos, notes and sub-notes, not another project's", async () => {
    for (const key of ["T", "Tsub", "D", "N1", "N1a"]) {
      const type = ITEMS.find((i) => i.key === key)!.type;
      expect((await resolveAccess(viewer.id, type, id[key]!, ON)).role, key).toBe("VIEWER");
    }
    for (const [key, type] of [
      ["Tp2", "TASK"],
      ["Dp2", "TODO"],
      ["P2", "PROJECT"],
      ["Tnone", "TASK"],
      ["N2", "NOTE"],
    ] as const) {
      expect((await resolveAccess(viewer.id, type, id[key]!, ON)).role, key).toBeNull();
    }
  });

  it("a note grant reaches that note and every note under it, never the parent or a sibling", async () => {
    for (const key of ["N2", "N2a", "N2aa"])
      expect((await resolveAccess(noteViewer.id, "NOTE", id[key]!, ON)).role, key).toBe("VIEWER");
    expect((await resolveAccess(noteViewer.id, "NOTE", id.N3!, ON)).role).toBeNull();
    expect((await resolveAccess(noteViewer.id, "NOTE", id.N1!, ON)).role).toBeNull();
    // A grant on a sub-note does not reach its parent.
    expect((await resolveAccess(noteEditor.id, "NOTE", id.N3a!, ON)).role).toBe("EDITOR");
    expect((await resolveAccess(noteEditor.id, "NOTE", id.N3!, ON)).role).toBeNull();
    // A note grant says nothing about projects, tasks or todos.
    expect((await resolveAccess(noteViewer.id, "PROJECT", id.P!, ON)).role).toBeNull();
    expect((await resolveAccess(noteViewer.id, "TASK", id.T!, ON)).role).toBeNull();
  });

  it("takes the highest role: a viewer on the project who is a commenter on a note inside it comments there", async () => {
    expect((await resolveAccess(mixed.id, "NOTE", id.N1!, ON)).role).toBe("COMMENTER");
    expect((await resolveAccess(mixed.id, "NOTE", id.N1a!, ON)).role).toBe("COMMENTER");
    expect((await resolveAccess(mixed.id, "TASK", id.T!, ON)).role).toBe("VIEWER");
  });

  it("never reaches a journal entry or a sticky note, even inside a shared project", async () => {
    expect((await resolveAccess(editor.id, "NOTE", id.Journal!, ON)).role).toBeNull();
    expect((await resolveAccess(editor.id, "TASK", id.Sticky!, ON)).role).toBeNull();
    // The owner still has both.
    expect((await resolveAccess(owner.id, "NOTE", id.Journal!, ON)).role).toBe("OWNER");
    expect((await resolveAccess(owner.id, "TASK", id.Sticky!, ON)).role).toBe("OWNER");
  });

  it("hides what is in Trash from collaborators, and shows it to the owner", async () => {
    expect((await resolveAccess(editor.id, "TASK", id.Ttrashed!, ON)).role).toBeNull();
    expect((await resolveAccess(editor.id, "NOTE", id.Ntrashed!, ON)).role).toBeNull();
    expect((await resolveAccess(owner.id, "TASK", id.Ttrashed!, ON)).role).toBe("OWNER");
  });

  it("gives collaborators nothing while their project is in Trash, and everything back when it is restored", async () => {
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, id.P!));
    for (const [key, type] of [
      ["P", "PROJECT"],
      ["T", "TASK"],
      ["D", "TODO"],
      ["N1", "NOTE"],
    ] as const) {
      expect((await resolveAccess(editor.id, type, id[key]!, ON)).role, key).toBeNull();
    }
    await db.update(projects).set({ deletedAt: null }).where(eq(projects.id, id.P!));
    expect((await resolveAccess(editor.id, "TASK", id.T!, ON)).role).toBe("EDITOR");
  });

  it("moving a note out of the shared project ends access, and into it starts it", async () => {
    await db.update(notes).set({ projectId: null }).where(eq(notes.id, id.N1a!));
    expect((await resolveAccess(viewer.id, "NOTE", id.N1a!, ON)).role).toBeNull();
    await db.update(notes).set({ projectId: id.P! }).where(eq(notes.id, id.N1a!));
    expect((await resolveAccess(viewer.id, "NOTE", id.N1a!, ON)).role).toBe("VIEWER");
    await db.update(tasks).set({ projectId: id.P2! }).where(eq(tasks.id, id.T!));
    expect((await resolveAccess(viewer.id, "TASK", id.T!, ON)).role).toBeNull();
    await db.update(tasks).set({ projectId: id.P! }).where(eq(tasks.id, id.T!));
    expect((await resolveAccess(viewer.id, "TASK", id.T!, ON)).role).toBe("VIEWER");
  });

  it("ignores a grant that was not made by the item's owner", async () => {
    // `stranger` claims to own the project and "grants" it to someone: it reaches nothing.
    const outsider = await createTestUser("acl-outsider");
    await grant("PROJECT", id.P!, outsider, "EDITOR", stranger.id);
    expect((await resolveAccess(outsider.id, "PROJECT", id.P!, ON)).role).toBeNull();
    expect((await resolveAccess(outsider.id, "TASK", id.T!, ON)).role).toBeNull();
  });

  it("the database refuses a person granting themself and a second grant on the same item", async () => {
    await expect(grant("PROJECT", id.P!, owner, "EDITOR")).rejects.toThrow();
    await expect(grant("PROJECT", id.P!, editor, "VIEWER")).rejects.toThrow();
  });

  it("removing the grant ends access at once", async () => {
    const temp = await createTestUser("acl-temp");
    await grant("PROJECT", id.P!, temp, "EDITOR");
    expect((await resolveAccess(temp.id, "TASK", id.T!, ON)).role).toBe("EDITOR");
    await db.delete(resourceGrants).where(eq(resourceGrants.granteeId, temp.id));
    expect((await resolveAccess(temp.id, "TASK", id.T!, ON)).role).toBeNull();
  });
});

// ---- Lists --------------------------------------------------------------------------------------------------------

const idsOf = async (type: ResourceType, who: TestUser, options: { enabled: boolean } = ON) => {
  const where = accessibleWhere(who.id, type, options);
  const rows =
    type === "PROJECT"
      ? await db.select({ id: projects.id }).from(projects).where(where)
      : type === "TASK"
        ? await db.select({ id: tasks.id }).from(tasks).where(where)
        : type === "TODO"
          ? await db.select({ id: todos.id }).from(todos).where(where)
          : await db.select({ id: notes.id }).from(notes).where(where);
  return rows.map((r) => r.id).sort();
};
const names = (keys: string[]) => keys.map((k) => id[k]!).sort();

describe("lists", () => {
  it("a project collaborator's lists hold the shared project's live items and nothing else", async () => {
    expect(await idsOf("PROJECT", editor)).toEqual(names(["P"]));
    expect(await idsOf("TASK", editor)).toEqual(names(["T", "Tsub"]));
    expect(await idsOf("TODO", editor)).toEqual(names(["D"]));
    expect(await idsOf("NOTE", editor)).toEqual(names(["N1", "N1a"]));
    // The same for a viewer: reading is what a list is.
    expect(await idsOf("NOTE", viewer)).toEqual(names(["N1", "N1a"]));
  });

  it("a note collaborator's list holds that note and what is under it", async () => {
    expect(await idsOf("NOTE", noteViewer)).toEqual(names(["N2", "N2a", "N2aa"]));
    expect(await idsOf("NOTE", noteEditor)).toEqual(names(["N3a"]));
    expect(await idsOf("PROJECT", noteViewer)).toEqual([]);
    expect(await idsOf("TASK", noteViewer)).toEqual([]);
  });

  it("a stranger's lists are empty", async () => {
    for (const type of ["PROJECT", "TASK", "TODO", "NOTE"] as const)
      expect(await idsOf(type, stranger)).toEqual([]);
  });

  it("the owner's lists hold their own rows (the caller still filters Trash, as every query does)", async () => {
    const mine = await idsOf("NOTE", owner);
    for (const key of ["N1", "N2", "N3", "Journal"]) expect(mine).toContain(id[key]);
    expect(await idsOf("PROJECT", owner)).toEqual(names(["P", "P2"]));
  });

  it("never lists a journal entry, a sticky note or anything in Trash for a collaborator", async () => {
    expect(await idsOf("NOTE", editor)).not.toContain(id.Journal);
    expect(await idsOf("NOTE", editor)).not.toContain(id.Ntrashed);
    expect(await idsOf("TASK", editor)).not.toContain(id.Sticky);
    expect(await idsOf("TASK", editor)).not.toContain(id.Ttrashed);
  });

  it("agrees with resolveAccess: a row is listed exactly when the person has a role on it", async () => {
    for (const who of [editor, viewer, noteViewer, noteEditor, mixed, stranger]) {
      for (const type of ["TASK", "NOTE", "TODO", "PROJECT"] as const) {
        const listed = new Set(await idsOf(type, who));
        const all = await (type === "PROJECT"
          ? db.select({ id: projects.id }).from(projects).where(eq(projects.userId, owner.id))
          : type === "TASK"
            ? db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, owner.id))
            : type === "TODO"
              ? db.select({ id: todos.id }).from(todos).where(eq(todos.userId, owner.id))
              : db.select({ id: notes.id }).from(notes).where(eq(notes.userId, owner.id)));
        for (const row of all) {
          const role = (await resolveAccess(who.id, type, row.id, ON)).role;
          expect(listed.has(row.id), `${type} ${row.id} for ${who.name}`).toBe(role !== null);
        }
      }
    }
  });
});

// ---- The flag -----------------------------------------------------------------------------------------------------

describe("with sharing off", () => {
  it("only the owner has access, to everything of theirs, exactly as before sharing existed", async () => {
    for (const item of ITEMS) {
      expect((await resolveAccess(owner.id, item.type, id[item.key]!, OFF)).role, item.key).toBe(
        "OWNER",
      );
      for (const who of [editor, commenter, viewer, stranger]) {
        expect(
          (await resolveAccess(who.id, item.type, id[item.key]!, OFF)).role,
          `${item.key} ${who.name}`,
        ).toBeNull();
      }
    }
  });

  it("lists hold only the person's own rows, with the grants still in the database", async () => {
    for (const type of ["PROJECT", "TASK", "TODO", "NOTE"] as const) {
      expect(await idsOf(type, editor, OFF)).toEqual([]);
      expect(await idsOf(type, viewer, OFF)).toEqual([]);
    }
    const ownTasks = await idsOf("TASK", owner, OFF);
    const direct = (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, owner.id)))
      .map((r) => r.id)
      .sort();
    expect(ownTasks).toEqual(direct);
  });

  it("requireAccess answers NOT_FOUND to a collaborator, not UNAUTHORIZED", async () => {
    const error = await requireAccess(editor.id, "TASK", id.T!, "read", OFF).catch((e) => e);
    expect(error.code).toBe("NOT_FOUND");
  });
});

describe("cleanup safety", () => {
  it("deleting a person removes the grants they gave and received", async () => {
    const gone = await createTestUser("acl-gone");
    await grant("PROJECT", id.P!, gone, "VIEWER");
    const before = await db
      .select()
      .from(resourceGrants)
      .where(eq(resourceGrants.granteeId, gone.id));
    expect(before).toHaveLength(1);
    const { user } = await import("@/db/schema");
    await db.delete(user).where(inArray(user.id, [gone.id]));
    expect(
      await db.select().from(resourceGrants).where(eq(resourceGrants.granteeId, gone.id)),
    ).toHaveLength(0);
  });
});
