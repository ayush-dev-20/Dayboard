import { beforeAll, describe, expect, it, vi } from "vitest";

// Sharing on for this file: the actions read the flag from the environment when they are first imported.
vi.hoisted(() => {
  process.env.SHARING_ENABLED = "true";
});

import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { attachments, notes, projects, resourceGrants, tasks, todos } from "@/db/schema";
import { getReadyAttachment, listAttachments } from "@/db/queries/attachments";
import * as noteActions from "@/actions/notes";
import * as projectActions from "@/actions/projects";
import * as taskActions from "@/actions/tasks";
import * as todoActions from "@/actions/todos";
import { searchSharedWithMe } from "@/modules/sharing/service";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V3 feature 04 slice A2: the actions check the person, then work on the owner's rows. Real actions, real database.

let owner: TestUser, editor: TestUser, viewer: TestUser, stranger: TestUser;
let projectId: string, taskId: string, todoId: string, noteId: string;

beforeAll(async () => {
  owner = await createTestUser("sa-owner");
  editor = await createTestUser("sa-editor");
  viewer = await createTestUser("sa-viewer");
  stranger = await createTestUser("sa-stranger");
  const [p] = await db
    .insert(projects)
    .values({ userId: owner.id, name: "Shared" })
    .returning({ id: projects.id });
  projectId = p!.id;
  for (const [grantee, role] of [
    [editor, "EDITOR"],
    [viewer, "VIEWER"],
  ] as const) {
    await db.insert(resourceGrants).values({
      resourceType: "PROJECT",
      resourceId: projectId,
      ownerId: owner.id,
      granteeId: grantee.id,
      role,
    });
  }
  actAs(owner);
  taskId = ok(await taskActions.createTask({ title: "Owner task", projectId })).id;
  todoId = ok(await todoActions.createTodo({ title: "Owner todo", projectId })).id;
  noteId = ok(await noteActions.createNote({ title: "Owner note", projectId })).id;
});

describe("actions with sharing on", () => {
  it("an editor's new task lands in the owner's rows, with the editor as author", async () => {
    actAs(editor);
    const made = ok(await taskActions.createTask({ title: "By editor", projectId }));
    const [row] = await db.select().from(tasks).where(eq(tasks.id, made.id));
    expect(row?.userId).toBe(owner.id);
    expect(row?.createdByUserId).toBe(editor.id);
  });

  it("an editor's new todo and note do the same", async () => {
    actAs(editor);
    const todo = ok(await todoActions.createTodo({ title: "Todo by editor", projectId }));
    const note = ok(await noteActions.createNote({ title: "Note by editor", projectId }));
    const [t] = await db.select().from(todos).where(eq(todos.id, todo.id));
    const [n] = await db.select().from(notes).where(eq(notes.id, note.id));
    expect([t?.userId, t?.createdByUserId]).toEqual([owner.id, editor.id]);
    expect([n?.userId, n?.createdByUserId]).toEqual([owner.id, editor.id]);
  });

  it("an editor can edit and complete, and a note save records who saved", async () => {
    actAs(editor);
    ok(await taskActions.updateTask({ id: taskId, title: "Renamed" }));
    ok(await taskActions.setTaskStatus({ id: taskId, status: "DONE" }));
    const [n0] = await db.select().from(notes).where(eq(notes.id, noteId));
    const saved = ok(
      await noteActions.saveNoteTitle({ id: noteId, title: "New title", baseVersion: n0!.version }),
    );
    expect(saved.outcome).toBe("saved");
    const [n] = await db.select().from(notes).where(eq(notes.id, noteId));
    expect(n?.title).toBe("New title");
    expect(n?.updatedByUserId).toBe(editor.id);
  });

  it("an editor cannot restore, delete for good, or change project settings", async () => {
    actAs(editor);
    expect(errorOf(await projectActions.updateProject({ id: projectId, name: "x" })).code).toBe(
      "UNAUTHORIZED",
    );
    expect(errorOf(await projectActions.deleteProject({ id: projectId })).code).toBe(
      "UNAUTHORIZED",
    );
  });

  it("a viewer can change nothing: UNAUTHORIZED, and the rows are untouched", async () => {
    actAs(viewer);
    expect(errorOf(await taskActions.updateTask({ id: taskId, title: "Hack" })).code).toBe(
      "UNAUTHORIZED",
    );
    expect(errorOf(await todoActions.deleteTodo({ id: todoId })).code).toBe("UNAUTHORIZED");
    expect(errorOf(await taskActions.createTask({ title: "x", projectId })).code).toBe(
      "UNAUTHORIZED",
    );
    const [t] = await db.select().from(tasks).where(eq(tasks.id, taskId));
    expect(t?.title).toBe("Renamed");
    // ...but can read.
    expect(ok(await noteActions.loadNote({ id: noteId })).id).toBe(noteId);
  });

  it("a stranger finds nothing: NOT_FOUND, the same as for an id that does not exist", async () => {
    actAs(stranger);
    expect(errorOf(await noteActions.loadNote({ id: noteId })).code).toBe("NOT_FOUND");
    expect(errorOf(await taskActions.updateTask({ id: taskId, title: "x" })).code).toBe(
      "NOT_FOUND",
    );
    expect(errorOf(await taskActions.createTask({ title: "x", projectId })).code).toBe("NOT_FOUND");
    expect(errorOf(await projectActions.updateProject({ id: projectId, name: "x" })).code).toBe(
      "NOT_FOUND",
    );
  });

  it("the owner still does everything", async () => {
    actAs(owner);
    ok(await taskActions.updateTask({ id: taskId, title: "Owner again" }));
    ok(await projectActions.updateProject({ id: projectId, name: "Shared 2" }));
  });

  it("search over what is shared finds items in a shared project, labelled with the owner, and nothing else", async () => {
    actAs(owner);
    ok(await taskActions.createTask({ title: "Zebra budget review", projectId }));
    ok(await taskActions.createTask({ title: "Zebra private task" }));
    const hits = await searchSharedWithMe(viewer.id, "zebra");
    expect(hits.map((h) => h.title)).toEqual(["Zebra budget review"]);
    expect(hits[0]?.ownerName).toBe("sa-owner");
    expect(await searchSharedWithMe(stranger.id, "zebra")).toEqual([]);
  });

  it("a file on a shared item is served to people who can read the item, and to nobody else", async () => {
    const [file] = await db
      .insert(attachments)
      .values({
        userId: owner.id,
        ownerType: "PROJECT",
        ownerId: projectId,
        storageKey: `u/${owner.id}/test/${projectId}`,
        originalName: "plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        status: "READY",
      })
      .returning({ id: attachments.id });
    expect((await getReadyAttachment(viewer.id, file!.id))?.id).toBe(file!.id);
    expect(await listAttachments(viewer.id, "PROJECT", projectId)).toHaveLength(1);
    expect(await getReadyAttachment(stranger.id, file!.id)).toBeNull();
    expect(await listAttachments(stranger.id, "PROJECT", projectId)).toEqual([]);
  });
});
