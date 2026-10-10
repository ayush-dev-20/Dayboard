import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createNote } from "@/actions/notes";
import { createTask } from "@/actions/tasks";
import { setFocus } from "@/actions/today";
import { updateTask } from "@/actions/tasks";
import { db } from "@/db/client";
import { aiUsage, userPreferences } from "@/db/schema";
import { addDays } from "@/lib/dates/calendar";
import { getUserToday } from "@/lib/dates/today";
import type { StreamEvent } from "@/lib/ai/types";
import { POST as editSelection } from "@/app/api/ai/edit-selection/route";
import { POST as generate } from "@/app/api/ai/generate-content/route";
import { POST as planDay } from "@/app/api/ai/plan-day/route";
import { actAs, createTestUser, ok, setPreferences, type TestUser } from "./harness";

// Feature 08 against the real route handlers and database, with the mock provider.

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-write");
  bob = await createTestUser("bob-write");
});

const post = (handler: (r: Request) => Promise<Response>, body: unknown = {}) =>
  handler(
    new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }),
  );

async function json(response: Response) {
  return (await response.json()) as {
    error?: { code: string; message: string; retryAfterSeconds?: number };
  };
}
async function events(response: Response): Promise<StreamEvent[]> {
  return (await response.text())
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as StreamEvent);
}
const textOf = (list: StreamEvent[]) =>
  list.map((e) => (e.type === "text" ? e.delta : "")).join("");

const as = (who: TestUser) => actAs(who);
const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const usageRows = (userId: string) => db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
const prefs = async (userId: string) =>
  (await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)))[0]!;
const dayPrefs = { timezone: "Asia/Kolkata", startOfDay: "06:00" };
const today = () => getUserToday(dayPrefs);
const day = (offset: number) => addDays(today(), offset);

const GENERATE = {
  target: "new",
  prompt: "A brief for the Acme rebrand",
  length: "STANDARD",
  withTitle: true,
  useContext: false,
} as const;

describe("the new routes' pipeline", () => {
  it("need a signed-in person", async () => {
    actAs(null);
    for (const [handler, body] of [
      [generate, GENERATE],
      [planDay, {}],
      [editSelection, { mode: "IMPROVE", text: "hi" }],
    ] as const) {
      const response = await post(handler, body);
      expect(response.status).toBe(401);
      expect((await json(response)).error?.code).toBe("UNAUTHENTICATED");
    }
  });

  it("are AI_DISABLED when AI is off, and record nothing", async () => {
    const person = await createTestUser("off-write");
    await setPreferences(person.id, { aiEnabled: false });
    as(person);
    for (const [handler, body] of [
      [generate, GENERATE],
      [planDay, {}],
      [editSelection, { mode: "IMPROVE", text: "hi" }],
    ] as const) {
      const response = await post(handler, body);
      expect(response.status).toBe(403);
      expect((await json(response)).error?.code).toBe("AI_DISABLED");
    }
    expect(await usageRows(person.id)).toHaveLength(0);
  });

  it("validate the body strictly", async () => {
    as(alice);
    const bad: [typeof generate, unknown][] = [
      [generate, { ...GENERATE, prompt: "x".repeat(2001) }],
      [generate, { ...GENERATE, prompt: "   " }],
      [generate, { ...GENERATE, length: "HUGE" }],
      [generate, { ...GENERATE, userId: bob.id }],
      [generate, { ...GENERATE, target: "note" }], // a note needs an id
      [generate, { ...GENERATE, targetId: "0192f2a0-7c1e-7000-8000-0000000000aa" }], // new has none
      [generate, { ...GENERATE, target: "task", targetId: "nope" }],
      [planDay, { anything: 1 }],
      [editSelection, { mode: "IMPROVE", text: "x".repeat(6001) }],
      [editSelection, { mode: "IMPROVE", text: "   " }],
      [editSelection, { mode: "IMPROVE", text: "ok", before: "not allowed here" }],
      [editSelection, { mode: "CONTINUE", text: "", before: "  " }],
      [editSelection, { mode: "CONTINUE", text: "ok", before: "x".repeat(2001) }],
      [editSelection, { mode: "SHOUT", text: "ok" }],
      [editSelection, { mode: "IMPROVE", text: "ok", userId: bob.id }],
    ];
    for (const [handler, body] of bad) {
      const response = await post(handler, body);
      expect(response.status, JSON.stringify(body).slice(0, 80)).toBe(400);
      expect((await json(response)).error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rate-limit with a wait, and share the per-minute window", async () => {
    const person = await createTestUser("limit-write");
    as(person);
    for (let i = 0; i < 10; i += 1) {
      // Usage is recorded when a stream ends, so read each one to the end.
      const response = await post(editSelection, { mode: "IMPROVE", text: `Line ${i}` });
      expect(response.status).toBe(200);
      await response.text();
    }
    const blocked = await post(generate, GENERATE);
    expect(blocked.status).toBe(429);
    const body = await json(blocked);
    expect(body.error?.code).toBe("RATE_LIMITED");
    expect(body.error?.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("record the call with its feature and prompt version, and no text", async () => {
    const person = await createTestUser("usage-write");
    as(person);
    await (await post(generate, { ...GENERATE, prompt: "The secret launch codename" })).text();
    await (await post(editSelection, { mode: "SHORTEN", text: "Top secret passage here." })).text();
    const rows = (await usageRows(person.id)).sort((a, b) => a.feature.localeCompare(b.feature));
    expect(rows.map((r) => [r.feature, r.status, r.promptVersion])).toEqual([
      ["EDIT_SELECTION", "SUCCESS", "EDIT_SELECTION_V2"],
      ["GENERATE_CONTENT", "SUCCESS", "GENERATE_CONTENT_V2"],
    ]);
    expect(JSON.stringify(rows)).not.toContain("secret");
  });
});

describe("Generate with AI", () => {
  it("streams a title event, then Markdown, and never shows the TITLE: line", async () => {
    as(alice);
    const list = await events(await post(generate, GENERATE));
    expect(list.at(-1)).toEqual({ type: "done" });
    const titles = list.filter((e) => e.type === "title");
    expect(titles).toEqual([{ type: "title", text: "A brief for the Acme rebrand" }]);
    expect(list.findIndex((e) => e.type === "title")).toBeLessThan(
      list.findIndex((e) => e.type === "text"),
    );
    const body = textOf(list);
    expect(body).not.toContain("TITLE:");
    expect(body).toContain("# A brief for the Acme rebrand");
    expect(body).toContain("- [ ] Confirm the plan");
  });

  it("sends no title event when none was asked for, and length changes the amount", async () => {
    as(alice);
    const short = await events(
      await post(generate, { ...GENERATE, withTitle: false, length: "SHORT" }),
    );
    expect(short.some((e) => e.type === "title")).toBe(false);
    const long = await events(
      await post(generate, { ...GENERATE, withTitle: false, length: "DETAILED" }),
    );
    expect(textOf(long).length).toBeGreaterThan(textOf(short).length);
  });

  it("never honours a title request for a task", async () => {
    as(alice);
    const task = ok(await createTask({ title: "Write the report" }));
    const list = await events(
      await post(generate, {
        target: "task",
        targetId: task.id,
        prompt: "Outline",
        length: "SHORT",
        withTitle: true,
        useContext: true,
      }),
    );
    expect(list.some((e) => e.type === "title")).toBe(false);
    expect(textOf(list)).not.toContain("TITLE:");
  });

  it("reads the note or task by id and owner: someone else's is 404", async () => {
    as(bob);
    const note = ok(await createNote({ title: "Bob's note", contentJson: doc("Private words.") }));
    const task = ok(await createTask({ title: "Bob's task" }));
    as(alice);
    for (const body of [
      { target: "note", targetId: note.id },
      { target: "task", targetId: task.id },
    ]) {
      const response = await post(generate, { ...GENERATE, ...body, useContext: true });
      expect(response.status).toBe(404);
      expect((await json(response)).error?.code).toBe("NOT_FOUND");
    }
    // The owner can.
    as(bob);
    const mine = await post(generate, {
      ...GENERATE,
      target: "note",
      targetId: note.id,
      useContext: true,
    });
    expect(mine.status).toBe(200);
    await mine.text();
  });

  it("a failing provider ends the stream with an error event and records PROVIDER_ERROR", async () => {
    const person = await createTestUser("fail-write");
    as(person);
    const list = await events(
      await post(generate, { ...GENERATE, prompt: "Anything [mock:error]" }),
    );
    expect(list.at(-1)).toMatchObject({ type: "error", code: "AI_PROVIDER_ERROR" });
    expect((await usageRows(person.id))[0]).toMatchObject({ status: "PROVIDER_ERROR" });
  });

  it("a stream the client abandons still counts as a success", async () => {
    const person = await createTestUser("abort-write");
    as(person);
    const controller = new AbortController();
    const response = await generate(
      new Request("http://localhost/api/ai", {
        method: "POST",
        body: JSON.stringify(GENERATE),
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      }),
    );
    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();
    await reader.cancel().catch(() => undefined);
    // Usage is written when the route sees the end; give it a moment.
    for (let i = 0; i < 40 && (await usageRows(person.id)).length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect((await usageRows(person.id))[0]).toMatchObject({ status: "SUCCESS" });
  });
});

describe("Writing help", () => {
  it("streams plain text for each mode and never reads the workspace", async () => {
    as(alice);
    const improve = await events(
      await post(editSelection, { mode: "IMPROVE", text: "One thing.\n\nAnother thing." }),
    );
    expect(textOf(improve)).toBe("One thing. (improved)\n\nAnother thing. (improved)");

    const shorten = await events(
      await post(editSelection, { mode: "SHORTEN", text: "First point. Second point." }),
    );
    expect(textOf(shorten)).toBe("First point.");

    const fix = await events(
      await post(editSelection, { mode: "FIX_GRAMMAR", text: "I recieve teh mail." }),
    );
    expect(textOf(fix)).toBe("I receive the mail.");

    const next = await events(
      await post(editSelection, { mode: "CONTINUE", text: "", before: "Once upon a time." }),
    );
    expect(textOf(next).split("\n\n")).toHaveLength(2);
  });

  it("Continue needs text before the cursor; the other modes reject it", async () => {
    as(alice);
    expect((await post(editSelection, { mode: "CONTINUE", text: "" })).status).toBe(400);
    expect((await post(editSelection, { mode: "IMPROVE", text: "x", before: "y" })).status).toBe(
      400,
    );
  });
});

describe("Plan my day", () => {
  it("with nothing to plan the model isn't called and no usage is recorded", async () => {
    const person = await createTestUser("empty-plan");
    as(person);
    const list = await events(await post(planDay, {}));
    expect(list).toEqual([{ type: "done" }]);
    expect(await usageRows(person.id)).toHaveLength(0);
  });

  it("proposes only the person's own tasks, from our data, ignoring unknown ids and bad lines", async () => {
    const person = await createTestUser("plan-write");
    const other = await createTestUser("plan-other");
    as(other);
    ok(await createTask({ title: "Other's overdue", dueDate: day(-9) }));
    as(person);
    const late = ok(await createTask({ title: "Oldest late", dueDate: day(-6) }));
    ok(await createTask({ title: "Later", dueDate: day(-1) }));
    ok(await createTask({ title: "Due today", dueDate: today() }));
    ok(await createTask({ title: "Important", priority: "HIGH" }));
    ok(await createTask({ title: "Future low", dueDate: day(5) }));
    ok(await createTask({ title: "No date" }));

    const list = await events(await post(planDay, {}));
    expect(list.at(-1)).toEqual({ type: "done" });
    expect(list[0]).toMatchObject({ type: "summary" });
    const proposals = list.flatMap((e) => (e.type === "proposal" ? [e.item] : []));
    expect(proposals.map((p) => p.title)).toEqual([
      "Oldest late",
      "Later",
      "Due today",
      "Important",
    ]);
    expect(proposals[0]).toMatchObject({
      taskId: late.id,
      dueDate: day(-6),
      priority: "NONE",
      reason: "Overdue, so it goes first.",
    });
    expect(JSON.stringify(list)).not.toContain("Other's overdue");
    const rows = await usageRows(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "PLAN_DAY",
      status: "SUCCESS",
      promptVersion: "PLAN_DAY_V1",
    });
  });

  it("applies with the existing actions: dates and Focus set, someone else's task refused, Undo restores", async () => {
    const person = await createTestUser("apply-plan");
    const other = await createTestUser("apply-other");
    as(other);
    const theirs = ok(await createTask({ title: "Theirs", dueDate: day(-3) }));
    as(person);
    const a = ok(await createTask({ title: "Plan A", dueDate: day(-4) }));
    const b = ok(await createTask({ title: "Plan B", dueDate: today() }));

    ok(await updateTask({ id: a.id, dueDate: today() }));
    ok(await setFocus({ taskId: a.id }));
    expect((await prefs(person.id)).focusTaskId).toBe(a.id);

    // The same actions refuse another person's task: nothing changes there.
    expect((await updateTask({ id: theirs.id, dueDate: today() })).ok).toBe(false);
    expect((await setFocus({ taskId: theirs.id })).ok).toBe(false);
    expect((await prefs(person.id)).focusTaskId).toBe(a.id);

    // Undo.
    ok(await updateTask({ id: a.id, dueDate: day(-4) }));
    ok(await setFocus({ taskId: null }));
    expect((await prefs(person.id)).focusTaskId).toBeNull();
    expect(b.dueDate).toBe(today());
  });
});
