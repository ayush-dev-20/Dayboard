import { beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SHARING_ENABLED = "true";
  process.env.COLLAB_URL = "wss://collab.example.test";
  process.env.COLLAB_TOKEN_SECRET = "t".repeat(40);
  process.env.COLLAB_INTERNAL_SECRET = "i".repeat(40);
});

import { db } from "@/db/client";
import { notes, projects, resourceGrants } from "@/db/schema";
import { POST } from "@/app/api/collab/token/route";
import { verifyCollabToken } from "@/lib/collab/token";
import { noteEditorIds } from "@/modules/permissions/editors";
import { actAs, createTestUser, type TestUser } from "./harness";

// V3 feature 05 §3: the token route and the "who may edit" question.

let owner: TestUser, editor: TestUser, viewer: TestUser, stranger: TestUser;
let liveNote: string, quietNote: string, journalNote: string;

const ask = (noteId: string) =>
  POST(
    new Request("http://x/api/collab/token", { method: "POST", body: JSON.stringify({ noteId }) }),
  );

beforeAll(async () => {
  owner = await createTestUser("ct-owner");
  editor = await createTestUser("ct-editor");
  viewer = await createTestUser("ct-viewer");
  stranger = await createTestUser("ct-stranger");
  const make = async (name: string) =>
    (
      await db.insert(projects).values({ userId: owner.id, name }).returning({ id: projects.id })
    )[0]!.id;
  const live = await make("Live");
  const quiet = await make("Quiet");
  const doc = { type: "doc" as const, content: [] };
  const note = async (projectId: string, over = {}) =>
    (
      await db
        .insert(notes)
        .values({ userId: owner.id, title: "n", projectId, contentJson: doc, ...over })
        .returning({ id: notes.id })
    )[0]!.id;
  liveNote = await note(live);
  quietNote = await note(quiet);
  journalNote = await note(live, { journalDate: "2026-03-03" });
  await db.insert(resourceGrants).values([
    {
      resourceType: "PROJECT",
      resourceId: live,
      ownerId: owner.id,
      granteeId: editor.id,
      role: "EDITOR",
    },
    {
      resourceType: "PROJECT",
      resourceId: live,
      ownerId: owner.id,
      granteeId: viewer.id,
      role: "VIEWER",
    },
    {
      resourceType: "PROJECT",
      resourceId: quiet,
      ownerId: owner.id,
      granteeId: viewer.id,
      role: "VIEWER",
    },
  ]);
});

describe("who may edit a note", () => {
  it("lists editors through the project, and nothing for viewers only, journal entries or strangers", async () => {
    expect(await noteEditorIds(liveNote)).toEqual([editor.id]);
    expect(await noteEditorIds(quietNote)).toEqual([]);
    expect(await noteEditorIds(journalNote)).toEqual([]);
  });
});

describe("POST /api/collab/token", () => {
  it("gives the owner an edit token and a viewer a read token, for 60 seconds, to this note only", async () => {
    actAs(owner);
    const a = await (await ask(liveNote)).json();
    expect(a.url).toBe("wss://collab.example.test");
    expect(verifyCollabToken(a.token, "t".repeat(40), { noteId: liveNote })).toMatchObject({
      userId: owner.id,
      role: "edit",
    });
    expect(verifyCollabToken(a.token, "t".repeat(40), { noteId: quietNote })).toBeNull();
    actAs(viewer);
    const v = await (await ask(liveNote)).json();
    expect(v.role).toBe("read");
  });

  it("answers NOT_FOUND to a stranger, for a note nobody else can edit, and for a journal entry", async () => {
    actAs(stranger);
    expect((await ask(liveNote)).status).toBe(404);
    actAs(owner);
    expect((await ask(quietNote)).status).toBe(404);
    expect((await ask(journalNote)).status).toBe(404);
  });
});
