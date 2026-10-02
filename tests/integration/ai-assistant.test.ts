import { and, eq, count } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { captureInboxItem, dismissInboxSuggestion } from "@/actions/inbox";
import { createNote } from "@/actions/notes";
import { createTask, createTasksBatch } from "@/actions/tasks";
import { db } from "@/db/client";
import { aiDailySuggestions, aiUsage, inboxItems, taskNotes, tasks } from "@/db/schema";
import { addDays } from "@/lib/dates/calendar";
import { getUserToday } from "@/lib/dates/today";
import type { StreamEvent } from "@/lib/ai/types";
import { POST as actionItems } from "@/app/api/ai/action-items/route";
import { POST as ask } from "@/app/api/ai/ask/route";
import { POST as classify } from "@/app/api/ai/classify-inbox/route";
import { GET as daily } from "@/app/api/ai/daily-suggestion/route";
import { POST as extract } from "@/app/api/ai/extract-tasks/route";
import { POST as overdue } from "@/app/api/ai/overdue-cleanup/route";
import { POST as subtasks } from "@/app/api/ai/subtasks/route";
import { POST as summarize } from "@/app/api/ai/summarize-note/route";
import { POST as assist } from "@/app/api/ai/task-assist/route";
import { actAs, createTestUser, errorOf, ok, setPreferences, type TestUser } from "./harness";

// The real route handlers and real database, with the mock provider (NODE_ENV=test).

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-ai");
  bob = await createTestUser("bob-ai");
});

const post = (handler: (r: Request) => Promise<Response>, body: unknown = {}) =>
  handler(
    new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );
const get = (handler: (r: Request) => Promise<Response>, query = "") =>
  handler(new Request(`http://localhost/api/ai/daily-suggestion${query}`));

async function json(response: Response) {
  return (await response.json()) as {
    data?: Record<string, unknown>;
    error?: { code: string; message: string; retryAfterSeconds?: number };
  };
}
async function events(response: Response): Promise<StreamEvent[]> {
  const text = await response.text();
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
}

const as = (who: TestUser) => actAs(who);
const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const usageRows = (userId: string) => db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
const countTasks = async (userId: string) =>
  (await db.select({ n: count() }).from(tasks).where(eq(tasks.userId, userId)))[0]!.n;

describe("createTasksBatch", () => {
  it("creates all the tasks in one go, with dates", async () => {
    as(alice);
    const created = ok(
      await createTasksBatch({
        items: [{ title: "One", dueDate: "2026-11-01" }, { title: "Two" }],
      }),
    );
    expect(created.map((t) => t.title)).toEqual(["One", "Two"]);
    expect(created[0]!.dueDate).toBe("2026-11-01");
  });

  it("makes subtasks when given a parent, and refuses someone else's parent", async () => {
    as(alice);
    const parent = ok(await createTask({ title: "Parent" }));
    const subs = ok(
      await createTasksBatch({
        items: [{ title: "S1" }, { title: "S2" }, { title: "S3" }],
        parentTaskId: parent.id,
      }),
    );
    expect(subs.every((s) => s.parentTaskId === parent.id)).toBe(true);

    as(bob);
    const before = await countTasks(bob.id);
    const result = await createTasksBatch({
      items: [{ title: "Sneaky" }],
      parentTaskId: parent.id,
    });
    expect(errorOf(result).code).toBe("NOT_FOUND");
    expect(await countTasks(bob.id)).toBe(before);
  });

  it("links every task to the note, and refuses a note that isn't the person's", async () => {
    as(alice);
    const note = ok(await createNote({ title: "Kickoff", contentJson: doc("Hello") }));
    const created = ok(
      await createTasksBatch({ items: [{ title: "L1" }, { title: "L2" }], linkNoteId: note.id }),
    );
    const links = await db.select().from(taskNotes).where(eq(taskNotes.noteId, note.id));
    expect(links.map((l) => l.taskId).sort()).toEqual(created.map((t) => t.id).sort());

    as(bob);
    const before = await countTasks(bob.id);
    const result = await createTasksBatch({ items: [{ title: "Nope" }], linkNoteId: note.id });
    expect(errorOf(result).code).toBe("NOT_FOUND");
    expect(await countTasks(bob.id)).toBe(before);
  });

  it("is all or nothing: a failure part-way creates none of them", async () => {
    as(alice);
    const before = await countTasks(alice.id);
    // The inbox item doesn't exist, so the step after the tasks fails and everything rolls back.
    const result = await createTasksBatch({
      items: [{ title: "R1" }, { title: "R2" }],
      fromInboxItemId: "0192f2a0-7c1e-7000-8000-0000000000ff",
    });
    expect(errorOf(result).code).toBe("NOT_FOUND");
    expect(await countTasks(alice.id)).toBe(before);
  });

  it("marks an inbox item converted to the new tasks", async () => {
    as(alice);
    const item = ok(await captureInboxItem({ text: "Call Meera and send the agenda" }));
    const created = ok(
      await createTasksBatch({
        items: [{ title: "Call Meera" }, { title: "Send agenda" }],
        fromInboxItemId: item.id,
      }),
    );
    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, item.id));
    expect(row!.status).toBe("CONVERTED");
    expect(row!.convertedRefs).toEqual(created.map((t) => ({ type: "task", id: t.id })));
  });

  it("limits a batch to 15 and needs at least one", async () => {
    as(alice);
    const sixteen = Array.from({ length: 16 }, (_, i) => ({ title: `T${i}` }));
    expect(errorOf(await createTasksBatch({ items: sixteen })).code).toBe("VALIDATION_ERROR");
    expect(errorOf(await createTasksBatch({ items: [] })).code).toBe("VALIDATION_ERROR");
  });

  it("rejects mixing parent, note and inbox item", async () => {
    as(alice);
    const note = ok(await createNote({ title: "N" }));
    const parent = ok(await createTask({ title: "P" }));
    const result = await createTasksBatch({
      items: [{ title: "X" }],
      parentTaskId: parent.id,
      linkNoteId: note.id,
    });
    expect(errorOf(result).code).toBe("VALIDATION_ERROR");
  });
});

describe("the request pipeline", () => {
  it("needs a signed-in person", async () => {
    actAs(null);
    const response = await post(extract, { text: "hi" });
    expect(response.status).toBe(401);
    expect((await json(response)).error?.code).toBe("UNAUTHENTICATED");
  });

  it("is AI_DISABLED when the person switched AI off, and nothing is recorded", async () => {
    const person = await createTestUser("off-ai");
    await setPreferences(person.id, { aiEnabled: false });
    as(person);
    for (const [handler, body] of [
      [extract, { text: "Send the report" }],
      [subtasks, { taskId: "0192f2a0-7c1e-7000-8000-0000000000aa" }],
      [ask, { question: "anything" }],
      [overdue, {}],
    ] as const) {
      const response = await post(handler, body);
      expect(response.status).toBe(403);
      expect((await json(response)).error?.code).toBe("AI_DISABLED");
    }
    expect((await get(daily)).status).toBe(403);
    expect(await usageRows(person.id)).toHaveLength(0);
  });

  it("validates the request: text over 20,000 characters, unknown keys, bad ids", async () => {
    as(alice);
    const long = await post(extract, { text: "x".repeat(20_001) });
    expect(long.status).toBe(400);
    expect((await json(long)).error?.code).toBe("VALIDATION_ERROR");
    expect((await post(extract, { text: "hi", userId: bob.id })).status).toBe(400);
    expect((await post(subtasks, { taskId: "not-an-id" })).status).toBe(400);
    expect((await post(extract, {})).status).toBe(400);
  });

  it("records each call without any prompt or answer text", async () => {
    const person = await createTestUser("usage-ai");
    as(person);
    const response = await post(extract, { text: "Send the secret quarterly numbers to Meera" });
    expect(response.status).toBe(200);
    const rows = await usageRows(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "EXTRACT_TASKS",
      status: "SUCCESS",
      provider: "mock",
      promptVersion: "EXTRACT_TASKS_V1",
    });
    expect(JSON.stringify(rows[0])).not.toContain("secret");
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        "createdAt",
        "feature",
        "id",
        "inputTokens",
        "latencyMs",
        "model",
        "outputTokens",
        "promptVersion",
        "provider",
        "status",
        "userId",
      ].sort(),
    );
  });

  it("limits calls per minute, tells the person how long to wait, and records the attempt", async () => {
    const person = await createTestUser("limit-ai");
    as(person);
    for (let i = 0; i < 10; i += 1) {
      expect((await post(extract, { text: `Task number ${i}` })).status).toBe(200);
    }
    const blocked = await post(extract, { text: "One too many" });
    expect(blocked.status).toBe(429);
    const body = await json(blocked);
    expect(body.error?.code).toBe("RATE_LIMITED");
    expect(body.error?.retryAfterSeconds).toBeGreaterThan(0);
    expect(body.error?.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect(body.error?.message).toMatch(/Try again in \d+ seconds?\./);
    expect(blocked.headers.get("Retry-After")).toBe(String(body.error?.retryAfterSeconds));

    const rows = await usageRows(person.id);
    expect(rows.filter((r) => r.status === "RATE_LIMITED")).toHaveLength(1);
    // Blocked attempts don't count against the limit, so waiting never makes the wait longer.
    const again = await json(await post(extract, { text: "Still blocked" }));
    expect(again.error?.retryAfterSeconds).toBeLessThanOrEqual(body.error!.retryAfterSeconds!);
  });

  it("limits calls per local day", async () => {
    const person = await createTestUser("day-ai");
    await setPreferences(person.id, { timezone: "UTC" });
    // 100 successful calls spread over the last hour, so the per-minute window is clear.
    const old = new Date(Date.now() - 30 * 60_000);
    await db.insert(aiUsage).values(
      Array.from({ length: 100 }, () => ({
        userId: person.id,
        feature: "ASK" as const,
        provider: "mock",
        model: "mock",
        status: "SUCCESS" as const,
        promptVersion: "ASK_V1",
        createdAt: old,
      })),
    );
    // Skip the check when the test runs in the first 30 minutes after UTC midnight.
    if (old.getUTCDate() !== new Date().getUTCDate()) return;
    as(person);
    const response = await post(extract, { text: "Anything" });
    expect(response.status).toBe(429);
    expect((await json(response)).error?.retryAfterSeconds).toBeGreaterThan(60);
  });

  it("a failing provider is AI_PROVIDER_ERROR, and the failure is recorded", async () => {
    const person = await createTestUser("fail-ai");
    as(person);
    const response = await post(extract, { text: "Send the report [mock:error]" });
    expect(response.status).toBe(502);
    expect((await json(response)).error?.code).toBe("AI_PROVIDER_ERROR");
    const rows = await usageRows(person.id);
    expect(rows[0]).toMatchObject({ status: "PROVIDER_ERROR", feature: "EXTRACT_TASKS" });
  });
});

describe("features: preview only, scoped to the person", () => {
  it("text -> tasks returns a preview with dates resolved in the person's day, and creates nothing", async () => {
    const person = await createTestUser("extract-ai");
    await setPreferences(person.id, { timezone: "Asia/Kolkata" });
    as(person);
    const before = await countTasks(person.id);
    const response = await post(extract, {
      text: "Prepare client call notes and send agenda to Meera before Friday.\nLook into standing desks.",
    });
    const body = await json(response);
    const items = body.data!.items as { title: string; dueDate: string | null }[];
    expect(items.map((i) => i.title)).toEqual([
      "Prepare client call notes",
      "Send agenda to Meera",
      "Look into standing desks",
    ]);
    const today = getUserToday({ timezone: "Asia/Kolkata", startOfDay: "06:00:00" });
    expect(items[0]!.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(items[0]!.dueDate! > today).toBe(true);
    expect(items[2]!.dueDate).toBeNull();
    expect(await countTasks(person.id)).toBe(before);
  });

  it("an inbox item is read by id and owner, never from the client", async () => {
    as(alice);
    const item = ok(await captureInboxItem({ text: "Order new chairs" }));
    as(bob);
    const response = await post(extract, { inboxItemId: item.id });
    expect(response.status).toBe(404);
    as(alice);
    const mine = await json(await post(extract, { inboxItemId: item.id }));
    expect((mine.data!.items as { title: string }[])[0]!.title).toBe("Order new chairs");
  });

  it("subtasks: 3 to 8 suggestions for the person's own task, 404 for anyone else's", async () => {
    as(alice);
    const task = ok(await createTask({ title: "Plan the offsite" }));
    const mine = await json(await post(subtasks, { taskId: task.id }));
    const list = mine.data!.subtasks as { title: string }[];
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.length).toBeLessThanOrEqual(8);
    as(bob);
    expect((await post(subtasks, { taskId: task.id })).status).toBe(404);
  });

  it("subtasks refuses a task that is itself a subtask", async () => {
    as(alice);
    const parent = ok(await createTask({ title: "Parent" }));
    const [sub] = ok(
      await createTasksBatch({ items: [{ title: "Child" }], parentTaskId: parent.id }),
    );
    const response = await post(subtasks, { taskId: sub!.id });
    expect(response.status).toBe(400);
  });

  it("task assist covers all four modes and is scoped to the owner", async () => {
    as(alice);
    const task = ok(await createTask({ title: "Write the launch plan" }));
    const rewrite = (
      await json(await post(assist, { taskId: task.id, mode: "REWRITE_DESCRIPTION" }))
    ).data!;
    expect(typeof rewrite.description).toBe("string");
    const clarify = (await json(await post(assist, { taskId: task.id, mode: "CLARIFY" }))).data!;
    expect(typeof clarify.description).toBe("string");
    const estimate = (await json(await post(assist, { taskId: task.id, mode: "ESTIMATE" }))).data!;
    expect(["≤15m", "≤1h", "half-day", "1 day", "multi-day"]).toContain(estimate.estimate);
    const steps = (await json(await post(assist, { taskId: task.id, mode: "NEXT_STEPS" }))).data!;
    expect((steps.steps as string[]).length).toBeGreaterThan(0);
    as(bob);
    expect((await post(assist, { taskId: task.id, mode: "ESTIMATE" })).status).toBe(404);
  });

  it("summarize streams three labelled sections for the person's own note", async () => {
    as(alice);
    const note = ok(
      await createNote({
        title: "Kickoff",
        contentJson: doc(
          "We agreed the first milestone is the brand review. Next: book the design review.",
        ),
      }),
    );
    const response = await post(summarize, { noteId: note.id });
    expect(response.headers.get("Content-Type")).toContain("ndjson");
    const list = await events(response);
    const text = list
      .filter((e): e is Extract<StreamEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");
    expect(text).toContain("## Summary");
    expect(text).toContain("## Key points");
    expect(text).toContain("## Action items");
    expect(list.at(-1)).toEqual({ type: "done" });

    as(bob);
    expect((await post(summarize, { noteId: note.id })).status).toBe(404);
    // An empty note has nothing to summarize.
    as(alice);
    const empty = ok(await createNote({ title: "Empty" }));
    expect((await post(summarize, { noteId: empty.id })).status).toBe(400);
  });

  it("action items come from the person's own note", async () => {
    as(alice);
    const note = ok(
      await createNote({
        title: "Call",
        contentJson: doc("We talked.\nNext: book the design review and send the revised timeline."),
      }),
    );
    const body = await json(await post(actionItems, { noteId: note.id }));
    expect((body.data!.items as { title: string }[]).map((i) => i.title)).toEqual([
      "Book the design review",
      "Send the revised timeline",
    ]);
    as(bob);
    expect((await post(actionItems, { noteId: note.id })).status).toBe(404);
  });

  it("overdue cleanup proposes only for the person's own overdue tasks", async () => {
    const person = await createTestUser("overdue-ai");
    as(person);
    const today = getUserToday({ timezone: "UTC", startOfDay: "06:00:00" });
    const late = ok(await createTask({ title: "Late one", dueDate: addDays(today, -10) }));
    const high = ok(
      await createTask({ title: "Late high", dueDate: addDays(today, -5), priority: "HIGH" }),
    );
    ok(await createTask({ title: "Not late", dueDate: addDays(today, 3) }));
    as(bob);
    ok(await createTask({ title: "Bob late", dueDate: addDays(today, -10) }));

    as(person);
    const body = await json(await post(overdue, {}));
    const proposals = body.data!.proposals as { taskId: string; title: string; action: string }[];
    expect(proposals.map((p) => p.taskId).sort()).toEqual([late.id, high.id].sort());
    expect(proposals.find((p) => p.taskId === high.id)!.action).toBe("KEEP");
    expect(JSON.stringify(proposals)).not.toContain("Bob late");
  });

  it("overdue cleanup with nothing overdue doesn't call the model", async () => {
    const person = await createTestUser("tidy-ai");
    as(person);
    const body = await json(await post(overdue, {}));
    expect(body.data!.proposals).toEqual([]);
    expect(await usageRows(person.id)).toHaveLength(0);
  });

  it("classify stores the suggestion on the item, and Dismiss clears it", async () => {
    as(alice);
    const item = ok(await captureInboxItem({ text: "Buy printer paper" }));
    const body = await json(await post(classify, { inboxItemId: item.id }));
    expect(body.data!.suggestion).toMatchObject({ type: "TODO", confidence: "high" });
    const [stored] = await db.select().from(inboxItems).where(eq(inboxItems.id, item.id));
    expect(stored!.aiSuggestion).toMatchObject({ type: "TODO", title: "Buy printer paper" });
    // Only {type, title, confidence} is stored, and the text is untouched.
    expect(Object.keys(stored!.aiSuggestion as object).sort()).toEqual([
      "confidence",
      "title",
      "type",
    ]);
    expect(stored!.text).toBe("Buy printer paper");

    as(bob);
    expect((await post(classify, { inboxItemId: item.id })).status).toBe(404);
    expect(errorOf(await dismissInboxSuggestion({ id: item.id })).code).toBe("NOT_FOUND");

    as(alice);
    ok(await dismissInboxSuggestion({ id: item.id }));
    const [cleared] = await db.select().from(inboxItems).where(eq(inboxItems.id, item.id));
    expect(cleared!.aiSuggestion).toBeNull();
  });
});

describe("Ask my workspace", () => {
  it("answers from the person's own records, with sources, and never finds someone else's", async () => {
    const owner = await createTestUser("ask-owner");
    const other = await createTestUser("ask-other");
    as(owner);
    const note = ok(
      await createNote({
        title: "Client call: kickoff",
        contentJson: doc("Budget is still open, so I will confirm it in writing before Friday."),
      }),
    );

    const answer = await events(
      await post(ask, { question: "What did we decide about the budget?" }),
    );
    const text = answer
      .filter((e): e is Extract<StreamEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");
    expect(text).toContain("[S1]");
    const sources = answer.find(
      (e): e is Extract<StreamEvent, { type: "sources" }> => e.type === "sources",
    )!;
    expect(sources.sources).toEqual([
      expect.objectContaining({
        label: "S1",
        type: "note",
        id: note.id,
        href: `/notes/${note.id}`,
      }),
    ]);
    expect(sources.quotes).toHaveLength(1);

    // Isolation: the other person asks about the same words and gets nothing, and no model call.
    as(other);
    const before = (await usageRows(other.id)).length;
    const none = await events(
      await post(ask, { question: "What did we decide about the budget?" }),
    );
    expect(none[0]).toEqual({
      type: "text",
      delta: "I couldn't find anything about that in your workspace.",
    });
    expect(JSON.stringify(none)).not.toContain(note.id);
    expect(JSON.stringify(none)).not.toContain("Client call");
    expect(await usageRows(other.id)).toHaveLength(before);
  });

  it("without anything relevant, the model isn't called and no quota is used", async () => {
    const person = await createTestUser("ask-none");
    as(person);
    const out = await events(await post(ask, { question: "Who won the 2010 World Cup?" }));
    expect(out.some((e) => e.type === "text" && e.delta.includes("couldn't find anything"))).toBe(
      true,
    );
    expect(await usageRows(person.id)).toHaveLength(0);
  });

  it("a question with only stop-words finds nothing", async () => {
    const person = await createTestUser("ask-stop");
    as(person);
    const out = await events(await post(ask, { question: "What is the" }));
    expect(out[0]).toMatchObject({ type: "text" });
    expect(await usageRows(person.id)).toHaveLength(0);
  });

  it("a failing provider ends the stream with an error event", async () => {
    const person = await createTestUser("ask-fail");
    as(person);
    ok(await createNote({ title: "Budget plans", contentJson: doc("The budget is open.") }));
    const out = await events(await post(ask, { question: "budget [mock:error]" }));
    expect(out.find((e) => e.type === "error")).toMatchObject({ code: "AI_PROVIDER_ERROR" });
    expect((await usageRows(person.id))[0]).toMatchObject({
      status: "PROVIDER_ERROR",
      feature: "ASK",
    });
  });
});

describe("daily suggestion", () => {
  it("is generated once, then served from the stored row without using quota", async () => {
    const person = await createTestUser("daily-ai");
    as(person);
    const today = getUserToday({ timezone: "UTC", startOfDay: "06:00:00" });
    ok(await createTask({ title: "Late", dueDate: addDays(today, -2) }));

    const first = await json(await get(daily));
    expect(first.data!.text).toEqual(expect.any(String));
    expect(first.data!.canRefresh).toBe(true);
    expect((first.data!.text as string).length).toBeLessThanOrEqual(280);
    expect(await usageRows(person.id)).toHaveLength(1);
    expect(JSON.stringify(await usageRows(person.id))).not.toContain("Late");

    const second = await json(await get(daily));
    expect(second.data!.text).toBe(first.data!.text);
    expect(await usageRows(person.id)).toHaveLength(1);

    const [row] = await db
      .select()
      .from(aiDailySuggestions)
      .where(eq(aiDailySuggestions.userId, person.id));
    expect(row!.localDate).toBe(today);
  });

  it("allows one refresh a day", async () => {
    const person = await createTestUser("daily-refresh");
    as(person);
    await get(daily);
    const refreshed = await json(await get(daily, "?refresh=1"));
    expect(refreshed.data!.canRefresh).toBe(false);
    const again = await get(daily, "?refresh=1");
    expect(again.status).toBe(409);
    expect(await usageRows(person.id)).toHaveLength(2);
  });

  it("is per person", async () => {
    as(alice);
    await get(daily);
    as(bob);
    const rows = await db
      .select()
      .from(aiDailySuggestions)
      .where(and(eq(aiDailySuggestions.userId, bob.id)));
    expect(rows).toHaveLength(0);
  });
});
