import { and, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createProject } from "@/actions/projects";
import { confirmVoice, undoVoice } from "@/actions/voice";
import { PUT as objectPut } from "@/app/api/storage/object/route";
import { POST as finalizeRoute } from "@/app/api/voice/captures/[id]/finalize/route";
import { POST as retryRoute } from "@/app/api/voice/captures/[id]/retry/route";
import { DELETE as discardRoute, GET as getRoute } from "@/app/api/voice/captures/[id]/route";
import { GET as listRoute, POST as intentRoute } from "@/app/api/voice/captures/route";
import { db } from "@/db/client";
import {
  aiUsage,
  attachments,
  auditLog,
  jobs,
  notes,
  tasks,
  todos,
  voiceCaptures,
} from "@/db/schema";
import { countToday } from "@/lib/ai/usage";
import { uuidv7 } from "@/lib/ids";
import { ensureBuiltinHandlers } from "@/lib/jobs/builtin";
import { claimJobs } from "@/lib/jobs/claim";
import { runClaimed } from "@/lib/jobs/runner";
import { QUEUES } from "@/lib/jobs/types";
import { getStorage } from "@/lib/storage";
import { processCapture } from "@/lib/voice/process";
import { cleanupVoice, finalizeVoiceCapture } from "@/lib/voice/service";
import { VOICE_INTENTS_PER_MINUTE, type VoiceCaptureDetail } from "@/lib/voice/types";
import { actAs, createTestUser, ok, setPreferences, type TestUser } from "./harness";

// V2 feature 13 against the real routes, actions, database and the in-memory store, with the mock
// provider: the path from intent to consumed, who may touch a capture, what is refused, what fails and
// how it is retried, and what the cleanup removes. The mock cannot hear, so a test's "recording" is the
// start of a real WebM file followed by `mock-transcript:` and the words it should come back as.

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  ensureBuiltinHandlers();
  alice = await createTestUser("alice-voice");
  bob = await createTestUser("bob-voice");
});

const json = (body: unknown) =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const nothing = () => new Request("http://localhost/api");

const WEBM_START = [0x1a, 0x45, 0xdf, 0xa3];
const recording = (words: string) =>
  Uint8Array.from([...WEBM_START, ...new TextEncoder().encode(`mock-transcript:${words}`)]);

type Err = { error?: { code: string; message: string } };
type Intent = Err & {
  capture: { id: string; status: string };
  upload: { url: string; headers: Record<string, string> } | null;
};

/**
 * Two limits would be reached by a long file of tests: ten new recordings a minute, and ten AI actions a
 * minute. Earlier ones are made to look older (and the AI record is cleared) first. The tests of the
 * limits themselves turn this off or set up their own.
 */
async function relax(who: TestUser) {
  await db.delete(aiUsage).where(eq(aiUsage.userId, who.id));
  await db
    .update(voiceCaptures)
    .set({ createdAt: new Date(Date.now() - 5 * 60_000) })
    .where(
      and(
        eq(voiceCaptures.userId, who.id),
        gt(voiceCaptures.createdAt, new Date(Date.now() - 60_000)),
      ),
    );
}

async function intent(who: TestUser, over: Record<string, unknown> = {}, size = 100, spare = true) {
  if (spare) await relax(who);
  actAs(who);
  const id = uuidv7();
  const res = await intentRoute(
    json({ id, mimeType: "audio/webm;codecs=opus", sizeBytes: size, durationMs: 4000, ...over }),
  );
  return { res, id, body: (await res.json()) as Intent };
}

/** A whole good upload through the presigned URL, ready to finalize. */
async function upload(who: TestUser, bytes: Uint8Array, over: Record<string, unknown> = {}) {
  const started = await intent(who, { sizeBytes: bytes.length, ...over }, bytes.length);
  expect(started.res.status, JSON.stringify(started.body)).toBe(200);
  const put = await objectPut(
    new Request(started.body.upload!.url, {
      method: "PUT",
      headers: started.body.upload!.headers,
      body: bytes as BodyInit,
    }),
  );
  expect(put.status).toBe(200);
  return started.id;
}

async function finalize(who: TestUser, id: string) {
  actAs(who);
  const res = await finalizeRoute(json({}), params(id));
  return {
    res,
    body: (await res.json()) as Err & { capture?: { status: string; errorCode: string | null } },
  };
}

async function detail(who: TestUser, id: string) {
  actAs(who);
  const res = await getRoute(nothing(), params(id));
  return { res, body: (await res.json()) as Err & { capture?: VoiceCaptureDetail } };
}

/** Records, uploads and finalizes (the mock runs inline: there is no worker in a test). */
async function ready(who: TestUser, words: string) {
  const id = await upload(who, recording(words));
  const done = await finalize(who, id);
  expect(done.res.status, JSON.stringify(done.body)).toBe(200);
  return id;
}

const rowOf = async (id: string) =>
  (await db.select().from(voiceCaptures).where(eq(voiceCaptures.id, id)))[0]!;
const exists = async (key: string | null) =>
  key ? (await getStorage()!.head(key)) !== null : false;

async function drain() {
  for (;;) {
    const claimed = await claimJobs("test-worker", QUEUES, 20);
    if (claimed.length === 0) return;
    for (const job of claimed) await runClaimed("test-worker", job);
  }
}

const counts = async (who: TestUser) => ({
  tasks: (await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.userId, who.id))).length,
  todos: (await db.select({ id: todos.id }).from(todos).where(eq(todos.userId, who.id))).length,
  notes: (await db.select({ id: notes.id }).from(notes).where(eq(notes.userId, who.id))).length,
});

describe("the path from recording to review", () => {
  it("uploads, transcribes and parses, and creates nothing", async () => {
    actAs(alice);
    const project = ok(await createProject({ name: "Acme Launch" }));
    const before = await counts(alice);
    const usageBefore = await countToday(alice.id, "UTC");

    const bytes = recording(
      "Call the dentist tomorrow. Buy milk. Send the Acme Launch report on Friday for the Acme Launch project.",
    );
    const started = await intent(alice, { sizeBytes: bytes.length }, bytes.length);
    expect(started.body.capture.status).toBe("UPLOADING");
    const row = await rowOf(started.id);
    expect(row.storageKey).toMatch(new RegExp(`^voice/${alice.id}/${started.id}/[0-9a-f]{32}$`));
    // The audio lives in storage, never in the database row.
    expect(JSON.stringify(row)).not.toContain("mock-transcript");
    expect(row.mimeType).toBe("audio/webm");

    await objectPut(
      new Request(started.body.upload!.url, {
        method: "PUT",
        headers: started.body.upload!.headers,
        body: bytes as BodyInit,
      }),
    );
    const done = await finalize(alice, started.id);
    expect(done.body.capture?.status).toBe("READY");

    const { body } = await detail(alice, started.id);
    expect(body.capture?.transcript).toContain("Call the dentist tomorrow");
    const items = body.capture!.parsed!.items;
    expect(items.map((i) => i.kind)).toEqual(["TASK", "TODO", "TASK"]);
    expect(items[0]!.dueDate).not.toBeNull();
    expect(items[2]).toMatchObject({ projectId: project.id, projectMention: "Acme Launch" });
    expect(body.capture!.parsed!.fallback).toBe(false);
    expect(body.capture!.hasAudio).toBe(true);

    // Nothing exists until the person confirms.
    expect(await counts(alice)).toEqual(before);
    // One AI action: the transcription is background work, the parse is the counted action.
    expect(await countToday(alice.id, "UTC")).toBe(usageBefore + 1);
    const usage = await db
      .select({ feature: aiUsage.feature, status: aiUsage.status })
      .from(aiUsage)
      .where(eq(aiUsage.userId, alice.id));
    expect(usage.filter((u) => u.feature === "TRANSCRIBE")).toHaveLength(1);
    expect(usage.filter((u) => u.feature === "VOICE_PARSE")).toHaveLength(1);
  });

  it("is safe to finalize again", async () => {
    const id = await upload(alice, recording("Buy bread."));
    const first = await finalize(alice, id);
    const second = await finalize(alice, id);
    expect(first.body.capture?.status).toBe("READY");
    expect(second.body.capture?.status).toBe("READY");
    expect(
      (
        await db
          .select()
          .from(aiUsage)
          .where(and(eq(aiUsage.userId, alice.id), eq(aiUsage.feature, "VOICE_PARSE")))
      ).length,
    ).toBeGreaterThan(0);
  });

  it("queues the job when a worker will run it, and the job does the work once", async () => {
    const id = await upload(alice, recording("Call Dana on Monday."));
    actAs(alice);
    const queued = await finalizeVoiceCapture(alice.id, id, { inline: false });
    expect(queued.status).toBe("QUEUED");
    const job = (
      await db
        .select()
        .from(jobs)
        .where(eq(jobs.dedupeKey, `transcription.process:${id}`))
    )[0];
    expect(job).toMatchObject({ type: "transcription.process", queue: "ai", userId: alice.id });
    // The payload holds the id only: no audio, no words.
    expect(job!.payload).toEqual({ captureId: id });

    await drain();
    expect((await rowOf(id)).status).toBe("READY");
    // Running it again (the inline path and the job both fire) does nothing.
    expect(await processCapture(alice.id, id)).toBe("SKIPPED");
  });

  it("takes back a capture a crashed run left transcribing, and leaves a fresh one alone", async () => {
    const id = await upload(alice, recording("Pay the rent."));
    await finalizeVoiceCapture(alice.id, id, { inline: false });
    await db.update(voiceCaptures).set({ status: "TRANSCRIBING" }).where(eq(voiceCaptures.id, id));
    expect(await processCapture(alice.id, id)).toBe("SKIPPED");
    await db
      .update(voiceCaptures)
      .set({ status: "TRANSCRIBING", updatedAt: new Date(Date.now() - 10 * 60_000) })
      .where(eq(voiceCaptures.id, id));
    expect(await processCapture(alice.id, id)).toBe("READY");
  });

  it("reads a rambling note nobody could structure as one note with the words", async () => {
    const id = await ready(alice, "Thinking about the garden [mock:parsefail]");
    const { body } = await detail(alice, id);
    expect(body.capture?.status).toBe("READY");
    expect(body.capture?.parsed?.fallback).toBe(true);
    expect(body.capture?.parsed?.items).toHaveLength(1);
    expect(body.capture?.parsed?.items[0]).toMatchObject({ kind: "NOTE" });
    expect(body.capture?.transcript).toContain("Thinking about the garden");
  });

  it("lists the captures still in play, newest first, for their owner only", async () => {
    const mine = await ready(alice, "A listed one.");
    actAs(alice);
    const listed = (await (await listRoute()).json()) as {
      captures: { id: string; status: string }[];
    };
    expect(listed.captures[0]!.id).toBe(mine);
    expect(
      listed.captures.every((c) =>
        ["UPLOADING", "QUEUED", "TRANSCRIBING", "READY", "FAILED"].includes(c.status),
      ),
    ).toBe(true);
    actAs(bob);
    const theirs = (await (await listRoute()).json()) as { captures: { id: string }[] };
    expect(theirs.captures.map((c) => c.id)).not.toContain(mine);
  });
});

describe("confirming", () => {
  it("creates exactly what was ticked, audits counts only, and clears the words and the recording", async () => {
    actAs(alice);
    const project = ok(await createProject({ name: "Garden" }));
    const id = await ready(alice, "Call the plumber. Buy soil. The shed needs a new roof.");
    const key = (await rowOf(id)).storageKey;
    expect(await exists(key)).toBe(true);
    const before = await counts(alice);

    actAs(alice);
    const created = ok(
      await confirmVoice({
        captureId: id,
        items: [
          {
            kind: "TASK",
            title: "Call the plumber about the sink",
            priority: "HIGH",
            dueDate: "2030-01-05",
            projectId: project.id,
          },
          { kind: "TODO", title: "Buy soil" },
          { kind: "NOTE", title: "Shed", body: "The shed needs a new roof." },
        ],
        transcriptNote: { title: "Garden call", text: "Call the plumber. Buy soil." },
        keepAudio: false,
      }),
    );
    expect(created.tasks).toHaveLength(1);
    expect(created.todos).toHaveLength(1);
    expect(created.notes).toHaveLength(2);
    expect(created.kept).toBeNull();

    const after = await counts(alice);
    expect(after).toEqual({
      tasks: before.tasks + 1,
      todos: before.todos + 1,
      notes: before.notes + 2,
    });
    const task = (await db.select().from(tasks).where(eq(tasks.id, created.tasks[0]!)))[0]!;
    expect(task).toMatchObject({
      title: "Call the plumber about the sink",
      priority: "HIGH",
      dueDate: "2030-01-05",
      projectId: project.id,
    });

    const row = await rowOf(id);
    expect(row).toMatchObject({
      status: "CONSUMED",
      transcript: null,
      parsed: null,
      storageKey: null,
    });
    expect(await exists(key)).toBe(false);

    const [audit] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, alice.id), eq(auditLog.proposalId, `voice:${id}`)));
    expect(audit).toMatchObject({ source: "VOICE", action: "voice.create" });
    expect(audit!.summary).toBe("Created 1 task, 1 todo and 2 notes from a voice capture");
    expect(audit!.summary).not.toMatch(/plumber|soil|shed/i);
    expect(audit!.entityRefs).toHaveLength(4);

    // Used once: a second confirm (a double click, a second tab) creates nothing.
    const again = await confirmVoice({
      captureId: id,
      items: [{ kind: "TODO", title: "Again" }],
      keepAudio: false,
    });
    expect(again.ok ? "ok" : again.error.code).toBe("CONFLICT");
    expect(await counts(alice)).toEqual(after);
  });

  it("keeps the recording as an attachment of the note when asked, and removes the temporary copy", async () => {
    const id = await ready(alice, "Remember the key under the mat.");
    const row = await rowOf(id);
    actAs(alice);
    const created = ok(
      await confirmVoice({
        captureId: id,
        items: [{ kind: "NOTE", title: "Key", body: "Under the mat." }],
        keepAudio: true,
      }),
    );
    expect(created.kept).toBe(true);
    const [file] = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.ownerType, "NOTE"), eq(attachments.ownerId, created.notes[0]!)));
    expect(file).toMatchObject({
      userId: alice.id,
      status: "READY",
      mimeType: "audio/webm",
      sizeBytes: row.sizeBytes,
    });
    expect(file!.originalName).toMatch(/^Voice recording \d{4}-\d{2}-\d{2}\.webm$/);
    expect(file!.storageKey).toMatch(new RegExp(`^u/${alice.id}/`));
    expect(await exists(file!.storageKey)).toBe(true);
    expect(await exists(row.storageKey)).toBe(false);
    expect((await rowOf(id)).keepAudio).toBe(true);
  });

  it("attaches the recording to the first task when no note was made", async () => {
    const id = await ready(alice, "Pay the electricity bill.");
    actAs(alice);
    const created = ok(
      await confirmVoice({
        captureId: id,
        items: [{ kind: "TASK", title: "Pay the bill" }],
        keepAudio: true,
      }),
    );
    expect(created.kept).toBe(true);
    const files = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.ownerType, "TASK"), eq(attachments.ownerId, created.tasks[0]!)));
    expect(files).toHaveLength(1);
  });

  it("still creates everything when the recording cannot be kept (a todo has nowhere to attach it)", async () => {
    const id = await ready(alice, "Buy eggs.");
    actAs(alice);
    const created = ok(
      await confirmVoice({
        captureId: id,
        items: [{ kind: "TODO", title: "Buy eggs" }],
        keepAudio: true,
      }),
    );
    expect(created.todos).toHaveLength(1);
    expect(created.kept).toBe(false);
    expect((await rowOf(id)).storageKey).toBeNull();
  });

  it("refuses a capture that is not ready, not theirs, or empty", async () => {
    const uploaded = await upload(alice, recording("Not yet."));
    actAs(alice);
    const early = await confirmVoice({
      captureId: uploaded,
      items: [{ kind: "TODO", title: "x" }],
      keepAudio: false,
    });
    expect(early.ok ? "ok" : early.error.code).toBe("CONFLICT");

    const mine = await ready(alice, "Private words.");
    actAs(bob);
    const stolen = await confirmVoice({
      captureId: mine,
      items: [{ kind: "TODO", title: "x" }],
      keepAudio: false,
    });
    expect(stolen.ok ? "ok" : stolen.error.code).toBe("NOT_FOUND");
    expect((await rowOf(mine)).status).toBe("READY");

    actAs(alice);
    const empty = await confirmVoice({ captureId: mine, items: [], keepAudio: false });
    expect(empty.ok ? "ok" : empty.error.code).toBe("VALIDATION_ERROR");
    expect((await rowOf(mine)).status).toBe("READY");
  });

  it("rolls back as one when part of it cannot be made", async () => {
    const id = await ready(alice, "Two things.");
    const before = await counts(alice);
    actAs(alice);
    // A project that is not theirs.
    actAs(bob);
    const bobsProject = ok(await createProject({ name: "Bob's" }));
    actAs(alice);
    const result = await confirmVoice({
      captureId: id,
      items: [
        { kind: "TODO", title: "Fine" },
        { kind: "TASK", title: "Bad", projectId: bobsProject.id },
      ],
      keepAudio: false,
    });
    expect(result.ok ? "ok" : result.error.code).toBe("NOT_FOUND");
    expect(await counts(alice)).toEqual(before);
    expect((await rowOf(id)).status).toBe("READY");
    expect(
      await db
        .select()
        .from(auditLog)
        .where(eq(auditLog.proposalId, `voice:${id}`)),
    ).toHaveLength(0);
  });

  it("undoes what it made, into the trash, and only the person's own", async () => {
    const id = await ready(alice, "Something to undo.");
    actAs(alice);
    const created = ok(
      await confirmVoice({
        captureId: id,
        items: [
          { kind: "TASK", title: "Undo task" },
          { kind: "TODO", title: "Undo todo" },
          { kind: "NOTE", title: "Undo note" },
        ],
        keepAudio: false,
      }),
    );
    const made = { tasks: created.tasks, todos: created.todos, notes: created.notes };
    actAs(bob);
    expect(ok(await undoVoice(made)).removed).toBe(0);
    actAs(alice);
    expect(ok(await undoVoice(made)).removed).toBe(3);
    const [task] = await db.select().from(tasks).where(eq(tasks.id, created.tasks[0]!));
    expect(task!.deletedAt).not.toBeNull();
    const [note] = await db.select().from(notes).where(eq(notes.id, created.notes[0]!));
    expect(note!.deletedAt).not.toBeNull();
  });
});

describe("who may touch a capture", () => {
  it("answers every route the same for someone else's capture as for one that does not exist", async () => {
    const mine = await ready(alice, "Mine alone.");
    const ghost = uuidv7();
    for (const id of [mine, ghost]) {
      actAs(bob);
      expect((await detail(bob, id)).body.error?.code).toBe("NOT_FOUND");
      expect((await finalize(bob, id)).body.error?.code).toBe("NOT_FOUND");
      expect((await retryRoute(json({}), params(id))).status).toBe(404);
      expect((await discardRoute(nothing(), params(id))).status).toBe(404);
    }
    expect((await rowOf(mine)).status).toBe("READY");
    expect(await exists((await rowOf(mine)).storageKey)).toBe(true);
  });

  it("does not reveal whose id it is when someone reuses it, and leaves the capture alone", async () => {
    const mine = await ready(alice, "Mine.");
    actAs(bob);
    const reused = await intentRoute(
      json({ id: mine, mimeType: "audio/webm", sizeBytes: 100, durationMs: 1000 }),
    );
    // The id is a device-made one, so a clash is only an attack or a bug: refused, and nothing leaks.
    expect(reused.status).toBe(400);
    const body = (await reused.json()) as Err;
    expect(body.error?.message).not.toMatch(/exist|taken|another/i);
    expect((await rowOf(mine)).userId).toBe(alice.id);
    expect((await rowOf(mine)).status).toBe("READY");
  });

  it("refuses a signed-out caller", async () => {
    actAs(null);
    expect((await intentRoute(json({}))).status).toBe(401);
    expect((await listRoute()).status).toBe(401);
    expect((await getRoute(nothing(), params(uuidv7()))).status).toBe(401);
  });

  it("refuses a malformed id as not found", async () => {
    actAs(alice);
    expect((await getRoute(nothing(), params("not-a-uuid"))).status).toBe(404);
  });

  it("keeps every recording under its owner's own prefix", async () => {
    const rows = await db
      .select({ key: voiceCaptures.storageKey, userId: voiceCaptures.userId })
      .from(voiceCaptures)
      .where(
        and(inArray(voiceCaptures.userId, [alice.id, bob.id]), isNotNull(voiceCaptures.storageKey)),
      );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.key!.startsWith(`voice/${row.userId}/`)).toBe(true);
  });
});

describe("what is refused", () => {
  it("a type that is not audio, a recording that is too big, and one that is too long", async () => {
    const type = await intent(alice, { mimeType: "video/mp4" });
    expect(type.res.status).toBe(415);
    const big = await intent(alice, { sizeBytes: 10 * 1024 * 1024 + 1 });
    expect(big.res.status).toBe(413);
    const long = await intent(alice, { durationMs: 5 * 60 * 1000 + 6000 });
    expect(long.res.status).toBe(413);
    const empty = await intent(alice, { sizeBytes: 0 });
    expect(empty.res.status).toBe(400);
  });

  it("accepts a recording right at the limits", async () => {
    const edge = await intent(alice, { sizeBytes: 10 * 1024 * 1024, durationMs: 5 * 60 * 1000 });
    expect(edge.res.status).toBe(200);
  });

  it("an upload that never arrived", async () => {
    const started = await intent(alice, { sizeBytes: 100 });
    expect(started.res.status).toBe(200);
    const done = await finalize(alice, started.id);
    expect(done.body.error?.code).toBe("VALIDATION_ERROR");
    expect((await rowOf(started.id)).status).toBe("UPLOADING");
  });

  it("an upload that is not the size it said, and removes it", async () => {
    const bytes = recording("short");
    const id = await upload(alice, bytes, { sizeBytes: bytes.length });
    const key = (await rowOf(id)).storageKey!;
    await db
      .update(voiceCaptures)
      .set({ sizeBytes: bytes.length + 50 })
      .where(eq(voiceCaptures.id, id));
    const done = await finalize(alice, id);
    expect(done.res.status).toBe(413);
    expect(await exists(key)).toBe(false);
    expect(await db.select().from(voiceCaptures).where(eq(voiceCaptures.id, id))).toHaveLength(0);
  });

  it("a file that is not what its type says, and removes it", async () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    const id = await upload(alice, html);
    const key = (await rowOf(id)).storageKey!;
    const done = await finalize(alice, id);
    expect(done.res.status).toBe(415);
    expect(await exists(key)).toBe(false);
    expect(await db.select().from(voiceCaptures).where(eq(voiceCaptures.id, id))).toHaveLength(0);
  });

  it("more than ten new recordings in a minute", async () => {
    const carol = await createTestUser("carol-voice");
    for (let i = 0; i < VOICE_INTENTS_PER_MINUTE; i += 1) {
      expect((await intent(carol, {}, 100, false)).res.status).toBe(200);
    }
    const over = await intent(carol, {}, 100, false);
    expect(over.res.status).toBe(429);
    expect(over.res.headers.get("Retry-After")).toBe("60");
  });
});

describe("AI off, and the switch", () => {
  it("is not available with AI off or the voice switch off, and discard still works", async () => {
    const dana = await createTestUser("dana-voice");
    const id = await ready(dana, "Before switching off.");
    await setPreferences(dana.id, { aiEnabled: false });
    expect((await intent(dana)).body.error?.code).toBe("AI_DISABLED");
    expect((await detail(dana, id)).body.error?.code).toBe("AI_DISABLED");
    await setPreferences(dana.id, { aiEnabled: true, voiceCaptureEnabled: false });
    expect((await intent(dana)).body.error?.code).toBe("AI_DISABLED");

    // The person can always get rid of what they recorded.
    const key = (await rowOf(id)).storageKey;
    actAs(dana);
    expect((await discardRoute(nothing(), params(id))).status).toBe(200);
    expect(await exists(key)).toBe(false);
    expect(await db.select().from(voiceCaptures).where(eq(voiceCaptures.id, id))).toHaveLength(0);
  });

  it("fails a queued capture when AI is switched off before the job runs, keeping the recording a day", async () => {
    const erin = await createTestUser("erin-voice");
    const id = await upload(erin, recording("Queued then off."));
    actAs(erin);
    await finalizeVoiceCapture(erin.id, id, { inline: false });
    await setPreferences(erin.id, { aiEnabled: false });
    await drain();
    expect(await rowOf(id)).toMatchObject({ status: "FAILED", errorCode: "AI_DISABLED" });
    expect(await exists((await rowOf(id)).storageKey)).toBe(true);
  });
});

describe("failures", () => {
  it("fails when the AI limit is reached, keeps the recording, and works on retry", async () => {
    const fran = await createTestUser("fran-voice");
    const id = await upload(fran, recording("Over the limit."));
    // The per-minute limit is ten counted actions.
    await db.insert(aiUsage).values(
      Array.from({ length: 10 }, () => ({
        userId: fran.id,
        feature: "ASK" as const,
        provider: "mock",
        model: "mock",
        status: "SUCCESS" as const,
        promptVersion: "ASK_V1",
        latencyMs: 1,
      })),
    );
    const done = await finalize(fran, id);
    expect(done.body.capture).toMatchObject({ status: "FAILED", errorCode: "RATE_LIMITED" });
    const key = (await rowOf(id)).storageKey;
    expect(await exists(key)).toBe(true);
    // The blocked attempt is written down but does not count.
    expect(
      await db
        .select()
        .from(aiUsage)
        .where(and(eq(aiUsage.userId, fran.id), eq(aiUsage.status, "RATE_LIMITED"))),
    ).toHaveLength(1);

    await db.delete(aiUsage).where(eq(aiUsage.userId, fran.id));
    actAs(fran);
    const retried = await retryRoute(json({}), params(id));
    expect(retried.status).toBe(200);
    expect(((await retried.json()) as { capture: { status: string } }).capture.status).toBe(
      "READY",
    );
  });

  it("fails when the provider fails, records it, keeps the recording and never the words", async () => {
    const gina = await createTestUser("gina-voice");
    const id = await upload(gina, recording("Secret words [mock:error]"));
    const done = await finalize(gina, id);
    expect(done.body.capture).toMatchObject({ status: "FAILED", errorCode: "AI_PROVIDER_ERROR" });
    const row = await rowOf(id);
    expect(row.transcript).toBeNull();
    expect(await exists(row.storageKey)).toBe(true);
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.userId, gina.id));
    expect(usage.some((u) => u.feature === "TRANSCRIBE" && u.status === "PROVIDER_ERROR")).toBe(
      true,
    );
    expect(JSON.stringify(usage)).not.toContain("Secret");
    // The same recording fails the same way again: retrying never creates a second copy of anything.
    actAs(gina);
    expect(
      ((await (await retryRoute(json({}), params(id))).json()) as { capture: { status: string } })
        .capture.status,
    ).toBe("FAILED");
  });

  it("says so when there was nothing to hear", async () => {
    const id = await upload(alice, recording("   "));
    const done = await finalize(alice, id);
    expect(done.body.capture).toMatchObject({ status: "FAILED", errorCode: "NO_SPEECH" });
  });

  it("will not retry a capture that has not failed, or whose recording is gone", async () => {
    const id = await ready(alice, "Fine already.");
    actAs(alice);
    const same = await retryRoute(json({}), params(id));
    expect(((await same.json()) as { capture: { status: string } }).capture.status).toBe("READY");

    const failed = await upload(alice, recording("Will fail [mock:error]"));
    await finalize(alice, failed);
    await db.update(voiceCaptures).set({ storageKey: null }).where(eq(voiceCaptures.id, failed));
    actAs(alice);
    expect((await retryRoute(json({}), params(failed))).status).toBe(400);
  });

  it("discard removes the recording, the words and the row", async () => {
    const id = await ready(alice, "Throw this away.");
    const key = (await rowOf(id)).storageKey;
    actAs(alice);
    expect((await discardRoute(nothing(), params(id))).status).toBe(200);
    expect(await exists(key)).toBe(false);
    expect(await db.select().from(voiceCaptures).where(eq(voiceCaptures.id, id))).toHaveLength(0);
  });
});

describe("the hourly cleanup", () => {
  const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000);

  it("deletes a recording a day after it was ready, keeps the words, and drops the row at seven days", async () => {
    const hana = await createTestUser("hana-voice");
    const id = await ready(hana, "Old news.");
    const key = (await rowOf(id)).storageKey;

    await cleanupVoice();
    expect(await exists(key)).toBe(true);

    await db
      .update(voiceCaptures)
      .set({ updatedAt: ago(25) })
      .where(eq(voiceCaptures.id, id));
    const first = await cleanupVoice();
    expect(first.audioRemoved).toBeGreaterThanOrEqual(1);
    expect(await exists(key)).toBe(false);
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: "READY", storageKey: null });
    expect(row.transcript).toContain("Old news");

    await db
      .update(voiceCaptures)
      .set({ expiresAt: ago(1) })
      .where(eq(voiceCaptures.id, id));
    const second = await cleanupVoice();
    expect(second.rowsRemoved).toBeGreaterThanOrEqual(1);
    expect(await db.select().from(voiceCaptures).where(eq(voiceCaptures.id, id))).toHaveLength(0);
  });

  it("deletes the recording of a failed capture after a day, and of one that never finished uploading", async () => {
    const ivy = await createTestUser("ivy-voice");
    const failed = await upload(ivy, recording("Will fail [mock:error]"));
    await finalize(ivy, failed);
    const stuck = await upload(ivy, recording("Never finalized"));
    const keys = [(await rowOf(failed)).storageKey, (await rowOf(stuck)).storageKey];

    await db
      .update(voiceCaptures)
      .set({ updatedAt: ago(25) })
      .where(eq(voiceCaptures.id, failed));
    await db
      .update(voiceCaptures)
      .set({ createdAt: ago(25) })
      .where(eq(voiceCaptures.id, stuck));
    const result = await cleanupVoice();
    expect(result.expiredUploads).toBeGreaterThanOrEqual(1);
    for (const key of keys) expect(await exists(key)).toBe(false);
    expect(await rowOf(stuck)).toMatchObject({
      status: "FAILED",
      errorCode: "EXPIRED",
      storageKey: null,
    });
  });

  it("deletes the recording a consumed capture could not delete at the time", async () => {
    const jo = await createTestUser("jo-voice");
    const id = await ready(jo, "Done with this.");
    const key = (await rowOf(id)).storageKey!;
    await db
      .update(voiceCaptures)
      .set({ status: "CONSUMED", transcript: null, parsed: null })
      .where(eq(voiceCaptures.id, id));
    await cleanupVoice();
    expect(await exists(key)).toBe(false);
    expect((await rowOf(id)).storageKey).toBeNull();
  });

  it("runs as the scheduled job", async () => {
    const [schedule] = await db.execute<{ cron: string; type: string }>(
      `select cron, type from job_schedules where name = 'voice.cleanup'` as never,
    );
    expect(schedule).toMatchObject({ cron: "every 1h", type: "voice.cleanup" });
  });
});
