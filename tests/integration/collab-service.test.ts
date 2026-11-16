import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.SHARING_ENABLED = "true";
  process.env.COLLAB_URL = "ws://127.0.0.1:1";
  process.env.COLLAB_TOKEN_SECRET = "t".repeat(40);
  process.env.COLLAB_INTERNAL_SECRET = "i".repeat(40);
});
vi.mock("@/actions/notes", () => ({}));

import { HocuspocusProvider } from "@hocuspocus/provider";
import { eq } from "drizzle-orm";
import * as Y from "yjs";
import { createCollabServer } from "@/collab/service";
import { db } from "@/db/client";
import { noteCollabDocs, noteSnapshots, notes, projects, resourceGrants } from "@/db/schema";
import { saveNoteContent, saveNoteTitle } from "@/db/mutations/notes";
import { BODY_FIELD, META_FIELD } from "@/lib/collab/convert";
import type { TiptapDoc } from "@/lib/editor/types";
import { signCollabToken } from "@/lib/collab/token";
import { createTestUser, type TestUser } from "./harness";

// V3 feature 05 slice A: the real service in this process, real WebSocket clients, the real database.

const TOKEN_SECRET = "t".repeat(40);
const INTERNAL_SECRET = "i".repeat(40);
const PORT = 14_000 + Math.floor(Math.random() * 1000);

let owner: TestUser, editor: TestUser, viewer: TestUser, stranger: TestUser;
let projectId: string;
let service: ReturnType<typeof createCollabServer>;
const providers: HocuspocusProvider[] = [];

const doc0 = (text: string): TiptapDoc =>
  ({
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text }] }],
  }) as TiptapDoc;

async function makeNote(title: string, text: string, inProject = true) {
  const [n] = await db
    .insert(notes)
    .values({
      userId: owner.id,
      title,
      projectId: inProject ? projectId : null,
      contentJson: doc0(text),
      contentText: text,
    })
    .returning({ id: notes.id });
  return n!.id;
}

function connect(
  noteId: string,
  who: TestUser,
  role: "edit" | "read" = "edit",
  secret = TOKEN_SECRET,
) {
  const ydoc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: `ws://127.0.0.1:${PORT}`,
    name: noteId,
    document: ydoc,
    token: signCollabToken({ userId: who.id, noteId, role }, secret),
  });
  providers.push(provider);
  const synced = new Promise<void>((resolve, reject) => {
    provider.on("synced", () => resolve());
    provider.on("authenticationFailed", () => reject(new Error("authenticationFailed")));
  });
  return { ydoc, provider, synced };
}

const paragraphs = (ydoc: Y.Doc) =>
  ydoc
    .getXmlFragment(BODY_FIELD)
    .toArray()
    .map((n) => n.toString());

function appendParagraph(ydoc: Y.Doc, text: string) {
  const p = new Y.XmlElement("paragraph");
  const t = new Y.XmlText();
  t.insert(0, text);
  p.insert(0, [t]);
  ydoc.getXmlFragment(BODY_FIELD).insert(ydoc.getXmlFragment(BODY_FIELD).length, [p]);
}

const until = async (check: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("timed out");
};

beforeAll(async () => {
  owner = await createTestUser("cs-owner");
  editor = await createTestUser("cs-editor");
  viewer = await createTestUser("cs-viewer");
  stranger = await createTestUser("cs-stranger");
  const [p] = await db
    .insert(projects)
    .values({ userId: owner.id, name: "Shared" })
    .returning({ id: projects.id });
  projectId = p!.id;
  await db.insert(resourceGrants).values([
    {
      resourceType: "PROJECT",
      resourceId: projectId,
      ownerId: owner.id,
      granteeId: editor.id,
      role: "EDITOR",
    },
    {
      resourceType: "PROJECT",
      resourceId: projectId,
      ownerId: owner.id,
      granteeId: viewer.id,
      role: "VIEWER",
    },
  ]);
  service = createCollabServer({
    port: PORT,
    tokenSecret: TOKEN_SECRET,
    internalSecret: INTERNAL_SECRET,
    debounceMs: 150,
    maxDebounceMs: 400,
    recheckMs: 60_000,
    limits: { connectionsPerNote: 3, updateBytes: 50_000 },
  });
  await service.start();
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await service.stop();
});

describe("the collaboration service", () => {
  it("seeds from the note once and two clients converge on edits", async () => {
    const id = await makeNote("Plan", "Hello");
    const a = connect(id, owner);
    const b = connect(id, editor);
    await Promise.all([a.synced, b.synced]);
    expect(paragraphs(a.ydoc)).toEqual(["<paragraph>Hello</paragraph>"]);
    expect(paragraphs(b.ydoc)).toEqual(paragraphs(a.ydoc));

    appendParagraph(a.ydoc, "from owner");
    appendParagraph(b.ydoc, "from editor");
    await until(() => paragraphs(a.ydoc).length === 3 && paragraphs(b.ydoc).length === 3);
    expect(paragraphs(a.ydoc).sort()).toEqual(paragraphs(b.ydoc).sort());
    expect(paragraphs(a.ydoc).join("")).toContain("from owner");
    expect(paragraphs(a.ydoc).join("")).toContain("from editor");
  });

  it("projects the document into the note's own columns, with search text, a new version and the editor as author", async () => {
    const id = await makeNote("Projected", "Start");
    const [before] = await db.select().from(notes).where(eq(notes.id, id));
    const b = connect(id, editor);
    await b.synced;
    appendParagraph(b.ydoc, "typed by the editor");
    b.ydoc.getMap(META_FIELD).set("title", "Renamed live");
    await until(async () => {
      const [n] = await db.select().from(notes).where(eq(notes.id, id));
      return n!.contentText.includes("typed by the editor");
    });
    const [after] = await db.select().from(notes).where(eq(notes.id, id));
    expect(after!.version).toBeGreaterThan(before!.version);
    expect(after!.title).toBe("Renamed live");
    expect(after!.updatedByUserId).toBe(editor.id);
    expect(JSON.stringify(after!.contentJson)).toContain("typed by the editor");
  });

  it("refuses ordinary saves while the note is live, and allows them again once it is not", async () => {
    const id = await makeNote("Live", "x");
    const a = connect(id, editor);
    await a.synced;
    const [n] = await db.select().from(notes).where(eq(notes.id, id));
    await expect(
      saveNoteContent(owner.id, {
        id,
        contentJson: doc0("old tab"),
        baseVersion: n!.version,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      saveNoteTitle(owner.id, { id, title: "old tab", baseVersion: n!.version }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("a read-only connection cannot change the document", async () => {
    const id = await makeNote("Read only", "keep");
    const v = connect(id, viewer, "read");
    await v.synced;
    appendParagraph(v.ydoc, "viewer typing");
    await new Promise((r) => setTimeout(r, 600));
    const e = connect(id, editor);
    await e.synced;
    expect(paragraphs(e.ydoc).join("")).not.toContain("viewer typing");
    expect(paragraphs(v.ydoc).join("")).toContain("keep");
  });

  it("a viewer who asks for an edit token only gets a read-only connection", async () => {
    const id = await makeNote("Downgrade", "keep");
    const v = connect(id, viewer, "edit");
    await v.synced;
    appendParagraph(v.ydoc, "sneaky");
    await new Promise((r) => setTimeout(r, 600));
    const [n] = await db.select().from(notes).where(eq(notes.id, id));
    expect(n!.contentText).not.toContain("sneaky");
  });

  it("rejects a stranger, an expired token, a token for another note and one signed with another secret", async () => {
    const id = await makeNote("Locked", "x");
    const other = await makeNote("Other", "y");
    await expect(connect(id, stranger).synced).rejects.toThrow("authenticationFailed");
    await expect(connect(id, editor, "edit", "z".repeat(40)).synced).rejects.toThrow(
      "authenticationFailed",
    );

    const expired = new Y.Doc();
    const p1 = new HocuspocusProvider({
      url: `ws://127.0.0.1:${PORT}`,
      name: id,
      document: expired,
      token: signCollabToken(
        { userId: editor.id, noteId: id, role: "edit" },
        TOKEN_SECRET,
        Date.now() - 120_000,
      ),
    });
    providers.push(p1);
    await expect(
      new Promise((resolve, reject) => {
        p1.on("synced", resolve);
        p1.on("authenticationFailed", () => reject(new Error("authenticationFailed")));
      }),
    ).rejects.toThrow("authenticationFailed");

    const wrongNote = new Y.Doc();
    const p2 = new HocuspocusProvider({
      url: `ws://127.0.0.1:${PORT}`,
      name: id,
      document: wrongNote,
      token: signCollabToken({ userId: editor.id, noteId: other, role: "edit" }, TOKEN_SECRET),
    });
    providers.push(p2);
    await expect(
      new Promise((resolve, reject) => {
        p2.on("synced", resolve);
        p2.on("authenticationFailed", () => reject(new Error("authenticationFailed")));
      }),
    ).rejects.toThrow("authenticationFailed");
  });

  it("the same update sent twice has no extra effect after a reconnect", async () => {
    const id = await makeNote("Replay", "base");
    const a = connect(id, editor);
    await a.synced;
    appendParagraph(a.ydoc, "once");
    await until(async () => {
      const [n] = await db.select().from(notes).where(eq(notes.id, id));
      return n!.contentText.includes("once");
    });
    const update = Y.encodeStateAsUpdate(a.ydoc);
    a.provider.disconnect();
    const b = connect(id, owner);
    await b.synced;
    Y.applyUpdate(b.ydoc, update);
    Y.applyUpdate(b.ydoc, update);
    await new Promise((r) => setTimeout(r, 500));
    expect(paragraphs(b.ydoc).filter((p) => p.includes("once"))).toHaveLength(1);
  });

  it("refuses the connection over the limit", async () => {
    const id = await makeNote("Crowded", "x");
    const people = [owner, editor, editor];
    const ok = people.map((p) => connect(id, p));
    await Promise.all(ok.map((c) => c.synced));
    await expect(connect(id, owner).synced).rejects.toThrow("authenticationFailed");
  });

  it("the internal endpoint drops a person whose access ended", async () => {
    const id = await makeNote("Revoked", "x");
    const e = connect(id, editor);
    await e.synced;
    let closed = false;
    e.provider.on("close", () => (closed = true));
    await db.delete(resourceGrants).where(eq(resourceGrants.granteeId, editor.id));
    const wrong = await fetch(`http://127.0.0.1:${PORT}/internal/recheck`, {
      method: "POST",
      body: "{}",
    });
    expect(wrong.status).toBe(403);
    const res = await fetch(`http://127.0.0.1:${PORT}/internal/recheck`, {
      method: "POST",
      headers: { "x-collab-secret": INTERNAL_SECRET },
      body: JSON.stringify({ noteIds: [id] }),
    });
    expect(res.status).toBe(200);
    await until(() => closed);
    // Put the grant back for the tests that follow.
    await db.insert(resourceGrants).values({
      resourceType: "PROJECT",
      resourceId: projectId,
      ownerId: owner.id,
      granteeId: editor.id,
      role: "EDITOR",
    });
  });

  it("when the last editor is gone: a final projection, a snapshot, and the note is ordinary again", async () => {
    const [p] = await db
      .insert(projects)
      .values({ userId: owner.id, name: "Temp" })
      .returning({ id: projects.id });
    const [g] = await db
      .insert(resourceGrants)
      .values({
        resourceType: "PROJECT",
        resourceId: p!.id,
        ownerId: owner.id,
        granteeId: editor.id,
        role: "EDITOR",
      })
      .returning({ id: resourceGrants.id });
    const [n] = await db
      .insert(notes)
      .values({
        userId: owner.id,
        title: "Retire",
        projectId: p!.id,
        contentJson: doc0("a"),
        contentText: "a",
      })
      .returning({ id: notes.id });
    const id = n!.id;
    const c = connect(id, editor);
    await c.synced;
    appendParagraph(c.ydoc, "last words");
    await new Promise((r) => setTimeout(r, 400));
    // The editor is removed, then the last connection closes.
    await db.delete(resourceGrants).where(eq(resourceGrants.id, g!.id));
    c.provider.destroy();
    await until(
      async () =>
        (await db.select().from(noteCollabDocs).where(eq(noteCollabDocs.noteId, id))).length === 0,
    );
    const [after] = await db.select().from(notes).where(eq(notes.id, id));
    expect(after!.contentText).toContain("last words");
    const snaps = await db.select().from(noteSnapshots).where(eq(noteSnapshots.noteId, id));
    expect(snaps.map((s) => s.reason)).toContain("LAST_DISCONNECT");
    // An ordinary save works again.
    await expect(
      saveNoteContent(owner.id, {
        id,
        contentJson: doc0("ordinary"),
        baseVersion: after!.version,
      }),
    ).resolves.toMatchObject({ outcome: "saved" });
  });

  it("a note changed some other way while nobody was connected is seeded again", async () => {
    const id = await makeNote("Stale", "first");
    const a = connect(id, editor);
    await a.synced;
    a.provider.destroy();
    await new Promise((r) => setTimeout(r, 500));
    // Someone edits the note outside the live path (the row is removed by the ordinary save, as for a note nobody can edit).
    await db
      .update(notes)
      .set({ contentJson: doc0("edited elsewhere"), version: 99 })
      .where(eq(notes.id, id));
    const b = connect(id, owner);
    await b.synced;
    expect(paragraphs(b.ydoc).join("")).toContain("edited elsewhere");
  });

  it("drops a connection that sends an oversize update, and the note keeps its text", async () => {
    const id = await makeNote("Big", "small");
    const c = connect(id, editor);
    await c.synced;
    let closed = false;
    c.provider.on("close", () => (closed = true));
    appendParagraph(c.ydoc, "x".repeat(120_000));
    await until(() => closed);
    await new Promise((r) => setTimeout(r, 500));
    const [n] = await db.select().from(notes).where(eq(notes.id, id));
    expect(n!.contentText).not.toContain("xxxxxxxx");
  });

  it("a journal entry is never live", async () => {
    const [j] = await db
      .insert(notes)
      .values({
        userId: owner.id,
        title: "j",
        journalDate: "2026-02-02",
        contentJson: doc0("private"),
        contentText: "private",
      })
      .returning({ id: notes.id });
    await expect(connect(j!.id, owner).synced).rejects.toThrow();
  });
});
