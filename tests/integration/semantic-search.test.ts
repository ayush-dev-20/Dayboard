import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { deleteNote, createNote } from "@/actions/notes";
import { GET as searchRoute } from "@/app/api/search/route";
import { createTask, setTaskStatus, updateTask } from "@/actions/tasks";
import { createTodo } from "@/actions/todos";
import { db } from "@/db/client";
import { embeddingChunks, embeddingUsageDays, searchDocuments } from "@/db/schema";
import { mockEmbedStats, resetMockEmbedStats } from "@/lib/ai/providers/mock-embed";
import { env } from "@/lib/env";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { claimJobs } from "@/lib/jobs/claim";
import { runClaimed } from "@/lib/jobs/runner";
import { QUEUES } from "@/lib/jobs/types";
import { getPreferences } from "@/lib/preferences";
import { indexEntity, markFailed } from "@/lib/search/semantic/indexer";
import { scanUser } from "@/lib/search/semantic/handlers";
import { searchHybrid } from "@/lib/search/semantic/hybrid";
import { countChanged, deleteIndex, usageDay } from "@/lib/search/semantic/store";
import type { SearchParams } from "@/lib/search/types";
import { actAs, createTestUser, ok, setPreferences, type TestUser } from "./harness";

// V2 feature 10 against a real database with pgvector and the mock embedder: the scan, the indexer, the
// jobs, and hybrid search. The mock knows that "login", "OTP" and "authentication" mean about the same.

const para = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const body = (...texts: string[]) => ({ type: "doc", content: texts.map(para) });
const query = (q: string, over: Partial<SearchParams> = {}): SearchParams => ({
  q,
  tab: "all",
  status: null,
  projectId: null,
  tagId: null,
  from: null,
  to: null,
  ...over,
});

let alice: TestUser;
let bob: TestUser;
let carol: TestUser;

async function drain() {
  for (;;) {
    const jobs = await claimJobs("test-worker", QUEUES, 10);
    if (jobs.length === 0) return;
    for (const job of jobs) await runClaimed("test-worker", job);
  }
}

/** One scan and every job it queued, as the worker would run them. */
async function reindex(user: TestUser) {
  const scan = await scanUser(user.id);
  await drain();
  return scan;
}

async function search(user: TestUser, q: string, over: Partial<SearchParams> = {}) {
  const prefs = await getPreferences(user.id);
  return searchHybrid(
    user.id,
    query(q, over),
    prefs,
    { timezone: prefs.timezone, startOfDay: prefs.startOfDay.slice(0, 5) },
    25,
  );
}

const titles = (hits: { title: string }[]) => hits.map((h) => h.title);

beforeAll(async () => {
  ensureBuiltinHandlers();
  alice = await createTestUser("alice");
  bob = await createTestUser("bob");
  carol = await createTestUser("carol");
  await setPreferences(alice.id, { semanticSearchEnabled: true });
  await setPreferences(bob.id, { semanticSearchEnabled: true });
  // carol never turns it on.
});

beforeEach(() => resetMockEmbedStats());

describe("search by meaning", () => {
  let noteId: string;
  let taskId: string;

  beforeAll(async () => {
    actAs(alice);
    noteId = ok(
      await createNote({
        title: "Sprint retro",
        contentJson: body("Login failures with OTP codes after the update"),
      }),
    ).id;
    ok(await createNote({ title: "Lunch", contentJson: body("Plan the team lunch on Friday") }));
    taskId = ok(await createTask({ title: "Rotate the password reset token" })).id;
    ok(await createTodo({ title: "Buy oranges" }));
    actAs(bob);
    ok(
      await createNote({
        title: "Bob private",
        contentJson: body("Authentication errors and login problems in the secret project"),
      }),
    );
    await reindex(alice);
    await reindex(bob);
  });

  it("finds a note without a shared keyword", async () => {
    const { results, semantic } = await search(alice, "authentication problems");
    expect(semantic).toBe("used");
    const hit = results.note.find((h) => h.id === noteId);
    expect(hit?.matchKind).toBe("semantic");
    expect(hit?.reasons?.passage).toContain("Login failures");
    expect(titles(results.note)).not.toContain("Lunch");
  });

  it("finds the related task from 'OTP security'", async () => {
    const { results } = await search(alice, "OTP security");
    expect(results.task.map((h) => h.id)).toContain(taskId);
    expect(titles(results.todo)).not.toContain("Buy oranges");
  });

  it("marks an item found both ways", async () => {
    const { results } = await search(alice, "login");
    expect(results.note.find((h) => h.id === noteId)?.matchKind).toBe("both");
  });

  it("never returns another person's items", async () => {
    const mine = await search(alice, "authentication problems");
    expect(titles(mine.results.note)).not.toContain("Bob private");
    const theirs = await search(bob, "authentication problems");
    expect(titles(theirs.results.note)).toEqual(["Bob private"]);
  });

  it("treats a quoted phrase as an exact match and as a filter on the meaning side", async () => {
    const exact = await search(alice, '"OTP codes"');
    expect(exact.results.note.map((h) => h.id)).toEqual([noteId]);
    expect(exact.results.note[0]!.reasons?.phrase).toBe(true);
    const both = await search(alice, 'authentication problems "OTP codes"');
    expect(both.results.note.map((h) => h.id)).toContain(noteId);
    const none = await search(alice, 'authentication problems "zebra crossing"');
    expect(none.results.note).toEqual([]);
  });

  it("applies filters to the meaning results", async () => {
    const notesOnly = await search(alice, "OTP security", { tab: "note" });
    expect(notesOnly.results.task).toEqual([]);
  });

  it("says 'off' when the person has not turned it on, and sends nothing", async () => {
    actAs(carol);
    ok(await createNote({ title: "Carol", contentJson: body("login problems") }));
    const scan = await reindex(carol);
    expect(scan).toEqual({ removed: 0, queued: 0, paused: false });
    expect(mockEmbedStats.calls).toBe(0);
    const { semantic, results } = await search(carol, "login problems");
    expect(semantic).toBe("off");
    expect(titles(results.note)).toEqual(["Carol"]);
  });

  it("returns keyword results with 'unavailable' when the provider fails", async () => {
    const { semantic, results } = await search(alice, "Sprint [mock:error]");
    expect(semantic).toBe("unavailable");
    expect(results.total).toBeGreaterThanOrEqual(0);
  });
});

describe("the scan", () => {
  let user: TestUser;
  let taskId: string;
  let noteId: string;

  beforeAll(async () => {
    user = await createTestUser("scanner");
    await setPreferences(user.id, { semanticSearchEnabled: true });
    actAs(user);
    taskId = ok(await createTask({ title: "Write the release notes" })).id;
    noteId = ok(await createNote({ title: "Plan", contentJson: body("Ship the release") })).id;
    await reindex(user);
  });

  it("indexed both items, and a second scan finds nothing to do", async () => {
    const docs = await db.select().from(searchDocuments).where(eq(searchDocuments.userId, user.id));
    expect(docs).toHaveLength(2);
    expect(await countChanged(user.id, "mock-embedding@768")).toBe(0);
    resetMockEmbedStats();
    expect(await reindex(user)).toMatchObject({ queued: 0, removed: 0 });
    expect(mockEmbedStats.calls).toBe(0);
  });

  it("re-queues an edited item but makes no model call when the text did not change", async () => {
    actAs(user);
    ok(await setTaskStatus({ id: taskId, status: "DONE" }));
    expect(await countChanged(user.id, "mock-embedding@768")).toBe(1);
    resetMockEmbedStats();
    await reindex(user);
    expect(mockEmbedStats.calls).toBe(0);
    expect(await countChanged(user.id, "mock-embedding@768")).toBe(0);
  });

  it("embeds again when the text changed", async () => {
    actAs(user);
    ok(await updateTask({ id: taskId, title: "Write the launch announcement" }));
    resetMockEmbedStats();
    await reindex(user);
    expect(mockEmbedStats.texts).toBe(1);
  });

  it("is idempotent: indexing twice gives the same rows", async () => {
    const before = await db
      .select()
      .from(embeddingChunks)
      .where(eq(embeddingChunks.userId, user.id));
    expect(await indexEntity(user.id, "NOTE", noteId)).toBe("unchanged");
    const after = await db
      .select()
      .from(embeddingChunks)
      .where(eq(embeddingChunks.userId, user.id));
    expect(after.map((c) => c.id).sort()).toEqual(before.map((c) => c.id).sort());
  });

  it("removes the index entry of a note moved to Trash", async () => {
    actAs(user);
    ok(await deleteNote({ id: noteId }));
    const scan = await scanUser(user.id);
    expect(scan.removed).toBe(1);
    const docs = await db.select().from(searchDocuments).where(eq(searchDocuments.userId, user.id));
    expect(docs.map((d) => d.entityType)).toEqual(["TASK"]);
    const chunks = await db
      .select()
      .from(embeddingChunks)
      .where(eq(embeddingChunks.userId, user.id));
    expect(chunks).toHaveLength(1);
  });

  it("leaves a failed item alone until it changes", async () => {
    actAs(user);
    const bad = ok(await createTask({ title: "Broken [mock:error] item" })).id;
    await expect(indexEntity(user.id, "TASK", bad)).rejects.toMatchObject({
      code: "AI_PROVIDER_ERROR",
    });
    await markFailed(user.id, "TASK", bad, "AI_PROVIDER_ERROR");
    expect(await scanUser(user.id)).toMatchObject({ queued: 0 });
    ok(await updateTask({ id: bad, title: "Fixed item" }));
    expect(await scanUser(user.id)).toMatchObject({ queued: 1 });
    await drain();
  });

  it("stops queueing work once the daily cap is used, and says so", async () => {
    await db
      .insert(embeddingUsageDays)
      .values({ userId: user.id, day: usageDay(), chunks: env.EMBED_DAILY_LIMIT })
      .onConflictDoUpdate({
        target: [embeddingUsageDays.userId, embeddingUsageDays.day],
        set: { chunks: env.EMBED_DAILY_LIMIT },
      });
    actAs(user);
    ok(await createTask({ title: "Another thing" }));
    expect(await scanUser(user.id)).toMatchObject({ queued: 0, paused: true });
    await db.delete(embeddingUsageDays).where(eq(embeddingUsageDays.userId, user.id));
  });

  it("turning it off deletes the whole index", async () => {
    await deleteIndex(user.id);
    expect(
      await db.select().from(searchDocuments).where(eq(searchDocuments.userId, user.id)),
    ).toEqual([]);
    expect(
      await db.select().from(embeddingChunks).where(eq(embeddingChunks.userId, user.id)),
    ).toEqual([]);
  });

  it("does nothing for an item queued before the person turned it off", async () => {
    await setPreferences(user.id, { semanticSearchEnabled: false });
    resetMockEmbedStats();
    expect(await indexEntity(user.id, "TASK", taskId)).toBe("skipped_off");
    expect(mockEmbedStats.calls).toBe(0);
  });
});

describe("recently opened items", () => {
  let mine: TestUser;
  let other: TestUser;
  const ids = {} as { note: string; task: string; trashed: string; theirs: string };

  async function recent(user: TestUser, open: string | null) {
    actAs(user);
    const qs = open === null ? "recent=1" : `recent=1&open=${encodeURIComponent(open)}`;
    const response = await searchRoute(new Request(`http://localhost/api/search?${qs}`));
    return (await response.json()) as {
      recent: { type: string; id: string; title: string }[];
      kept?: { type: string; id: string }[];
    };
  }

  beforeAll(async () => {
    mine = await createTestUser("opener");
    other = await createTestUser("stranger");
    actAs(mine);
    ids.note = ok(await createNote({ title: "My note", contentJson: body("hello") })).id;
    ids.task = ok(await createTask({ title: "My task" })).id;
    ids.trashed = ok(await createNote({ title: "Gone note", contentJson: body("bye") })).id;
    ok(await deleteNote({ id: ids.trashed }));
    actAs(other);
    ids.theirs = ok(await createNote({ title: "Not yours", contentJson: body("secret") })).id;
  });

  it("returns the opened items in the order given", async () => {
    const body = await recent(mine, `task:${ids.task},note:${ids.note}`);
    expect(body.recent.map((h) => h.title)).toEqual(["My task", "My note"]);
    expect(body.kept).toEqual([
      { type: "task", id: ids.task },
      { type: "note", id: ids.note },
    ]);
  });

  it("leaves out someone else's item, a trashed one and nonsense", async () => {
    const body = await recent(
      mine,
      `note:${ids.theirs},note:${ids.trashed},note:${ids.note},note:not-an-id,todo:${ids.task}`,
    );
    expect(body.recent.map((h) => h.title)).toEqual(["My note"]);
  });

  it("falls back to the most recently updated items when nothing was opened", async () => {
    const body = await recent(mine, null);
    expect(body.recent.length).toBeGreaterThan(0);
    expect(body.recent.map((h) => h.title)).not.toContain("Gone note");
    expect(body.recent.map((h) => h.title)).not.toContain("Not yours");
  });

  it("needs a signed-in person", async () => {
    actAs(null);
    const response = await searchRoute(
      new Request(`http://localhost/api/search?recent=1&open=note:${ids.note}`),
    );
    expect(response.status).toBe(401);
  });
});
