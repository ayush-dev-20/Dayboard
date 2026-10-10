import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import {
  applyAssistantProposal,
  describeAssistantItems,
  findAssistantItems,
  getRelatedItems,
} from "@/actions/assistant";
import { createNote, deleteNote, linkTaskNote } from "@/actions/notes";
import { createProject } from "@/actions/projects";
import { createTask } from "@/actions/tasks";
import { POST as askSelection } from "@/app/api/ai/ask-selection/route";
import { POST as assistant } from "@/app/api/ai/assistant/route";
import { POST as editSelection } from "@/app/api/ai/edit-selection/route";
import { db } from "@/db/client";
import { auditLog, aiUsage, taskNotes, tasks } from "@/db/schema";
import { SourceRegistry } from "@/lib/ai/assistant/registry";
import { createAssistantTools } from "@/lib/ai/assistant/tools";
import type { Proposal } from "@/lib/ai/assistant-types";
import type { StreamEvent } from "@/lib/ai/types";
import { addDays } from "@/lib/dates/calendar";
import { getUserToday } from "@/lib/dates/today";
import { actAs, createTestUser, errorOf, ok, setPreferences, type TestUser } from "./harness";

// V2 feature 11 against the real route handlers and database, with the mock provider: the assistant's
// tool loop, its owner scoping, proposals that change nothing until confirmed, and the audit log.

let alice: TestUser;
let bob: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-assistant");
  bob = await createTestUser("bob-assistant");
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
const proposalsOf = (list: StreamEvent[]): Proposal[] =>
  list.flatMap((e) => (e.type === "assistant-proposal" ? [e.proposal] : []));
const sourcesOf = (list: StreamEvent[]) => {
  const event = list.find((e) => e.type === "sources");
  return event?.type === "sources" ? event : { sources: [], quotes: [] };
};

const doc = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
const ask = (text: string, extra: Record<string, unknown> = {}) =>
  post(assistant, { messages: [{ role: "user", text }], ...extra });
const usage = (userId: string) => db.select().from(aiUsage).where(eq(aiUsage.userId, userId));
const taskCount = async (userId: string) =>
  (await db.select().from(tasks).where(eq(tasks.userId, userId))).length;
const audits = (userId: string) => db.select().from(auditLog).where(eq(auditLog.userId, userId));
const today = () => getUserToday({ timezone: "Asia/Kolkata", startOfDay: "06:00" });

async function note(who: TestUser, title: string, text: string): Promise<string> {
  actAs(who);
  return ok(await createNote({ title, contentJson: doc(text) })).id;
}

describe("the assistant route's pipeline", () => {
  it("needs a signed-in person, and AI on", async () => {
    actAs(null);
    expect((await ask("hello there")).status).toBe(401);

    const off = await createTestUser("ai-off-assistant");
    await setPreferences(off.id, { aiEnabled: false });
    actAs(off);
    const response = await ask("hello there");
    expect(response.status).toBe(403);
    expect((await json(response)).error?.code).toBe("AI_DISABLED");
  });

  it("refuses malformed requests, long histories and more than five items", async () => {
    actAs(alice);
    const id = "0192b6a0-0000-7000-8000-00000000aaaa";
    const lots = Array.from({ length: 11 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      text: `message ${i}`,
    }));
    for (const body of [
      {},
      { messages: [] },
      { messages: [{ role: "assistant", text: "hi" }] },
      {
        messages: [
          { role: "user", text: "hi" },
          { role: "assistant", text: "hello" },
        ],
      },
      { messages: lots },
      { messages: [{ role: "user", text: "x".repeat(4001) }] },
      { messages: [{ role: "user", text: "hi" }], extra: true },
      {
        messages: [{ role: "user", text: "hi" }],
        contexts: Array.from({ length: 6 }, () => ({ type: "note", id })),
      },
      {
        messages: [{ role: "user", text: "hi" }],
        context: { type: "note", id },
        contexts: [{ type: "note", id }],
      },
    ]) {
      const response = await post(assistant, body);
      expect(response.status, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
  });
});

describe("answering from the workspace", () => {
  it("searches, answers with a citation, and shows tool progress", async () => {
    const id = await note(alice, "Login failures", "Users report login failures with OTP codes.");
    await note(bob, "Bob's login notes", "Bob's own login failures notes with OTP.");
    actAs(alice);
    const list = await events(await ask("What did I write about login failures?"));
    expect(list.at(-1)).toEqual({ type: "done" });
    expect(list).toContainEqual({ type: "tool", name: "searchWorkspace", status: "start" });
    expect(list).toContainEqual({ type: "tool", name: "searchWorkspace", status: "done" });
    const answer = textOf(list);
    expect(answer).toContain("Login failures");
    const { sources } = sourcesOf(list);
    expect(sources.map((s) => s.id)).toEqual([id]);
    expect(sources[0]).toMatchObject({ label: "S1", type: "note", href: `/notes/${id}` });
    // Why it was found: recorded by the server, from the words in the question.
    expect(sources[0]!.reasons?.via).toBe("keyword");
    expect(sources[0]!.reasons?.matchedTerms).toEqual(expect.arrayContaining(["login"]));
    expect(sources[0]!.reasons?.passage).toContain("login failures");
    // Another person's note with the same words is never part of it.
    expect(JSON.stringify(list)).not.toContain("Bob");
  });

  it("says so when nothing matches, and cites nothing", async () => {
    actAs(alice);
    const list = await events(await ask("zebrafish quantum marmalade"));
    expect(textOf(list)).toContain("couldn't find anything");
    expect(sourcesOf(list).sources).toEqual([]);
  });

  it("lists overdue tasks through the task tool", async () => {
    actAs(alice);
    const project = ok(await createProject({ name: "Overdue project", color: "slate" })).id;
    const late = ok(
      await createTask({
        title: "Pay the invoice",
        dueDate: addDays(today(), -3),
        projectId: project,
      }),
    );
    ok(await createTask({ title: "Future thing", dueDate: addDays(today(), 5) }));
    const list = await events(await ask("What is overdue?"));
    expect(list).toContainEqual({ type: "tool", name: "listTasks", status: "done" });
    expect(sourcesOf(list).sources.map((s) => s.id)).toEqual([late.id]);
    expect(textOf(list)).toContain("Pay the invoice");
    expect(textOf(list)).not.toContain("Future thing");
  });

  it("records one usage row per turn, without any text", async () => {
    const person = await createTestUser("usage-assistant");
    await note(person, "Private plan", "The secret launch codename is Bluebird.");
    actAs(person);
    await (await ask("What is the secret launch codename?")).text();
    const rows = await usage(person.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: "ASSISTANT",
      status: "SUCCESS",
      promptVersion: "ASSISTANT_V1",
    });
    expect(JSON.stringify(rows)).not.toMatch(/secret|Bluebird/);
  });

  it("uses earlier messages in the thread, and treats old [S1] labels as stale", async () => {
    await note(alice, "Budget review", "The budget review covers hosting costs.");
    actAs(alice);
    const list = await events(
      await post(assistant, {
        messages: [
          { role: "user", text: "Tell me about the budget review" },
          { role: "assistant", text: "It is about hosting costs [S1]." },
          { role: "user", text: "budget review again please" },
        ],
      }),
    );
    expect(list.at(-1)).toEqual({ type: "done" });
    expect(sourcesOf(list).sources[0]?.label).toBe("S1");
  });
});

describe("pointing the assistant at items", () => {
  it("answers from the item only, and loads it by id and owner", async () => {
    const mine = await note(
      alice,
      "Roadmap draft",
      "Roadmap goals are hosting migration and billing.",
    );
    await note(alice, "Roadmap other", "Roadmap also mentions a secret hosting plan.");
    actAs(alice);
    const list = await events(
      await ask("summarize the roadmap hosting", { contexts: [{ type: "note", id: mine }] }),
    );
    expect(list).toContainEqual({ type: "tool", name: "getItem", status: "done" });
    expect(list.some((e) => e.type === "tool" && e.name === "searchWorkspace")).toBe(false);
    expect(sourcesOf(list).sources.map((s) => s.id)).toEqual([mine]);
    expect(JSON.stringify(list)).not.toContain("secret hosting plan");
  });

  it("refuses an id that is not theirs, is in Trash or is missing, the same way, and runs nothing", async () => {
    const others = await note(bob, "Bob's roadmap", "Bob's private roadmap.");
    const trashed = await note(alice, "Trashed", "Soon gone.");
    actAs(alice);
    ok(await deleteNote({ id: trashed }));
    const before = (await usage(alice.id)).length;
    for (const id of [others, trashed, "0192b6a0-0000-7000-8000-00000000bbbb"]) {
      actAs(alice);
      const response = await ask("what is in here", { contexts: [{ type: "note", id }] });
      expect(response.status, id).toBe(404);
      expect((await json(response)).error?.code).toBe("NOT_FOUND");
    }
    expect((await usage(alice.id)).length).toBe(before);
  });

  it("stands a project for its tasks and notes, and no more", async () => {
    actAs(alice);
    const project = ok(await createProject({ name: "Launch", color: "slate" })).id;
    ok(
      await createTask({
        title: "Order banners",
        projectId: project,
        dueDate: addDays(today(), -1),
      }),
    );
    ok(await createTask({ title: "Unrelated overdue", dueDate: addDays(today(), -1) }));
    const list = await events(
      await ask("what is overdue here", { contexts: [{ type: "project", id: project }] }),
    );
    expect(textOf(list)).toContain("Order banners");
    expect(textOf(list)).not.toContain("Unrelated overdue");
  });

  it("describes chips by id for the person only", async () => {
    const mine = await note(alice, "My chip", "text");
    const others = await note(bob, "Bob chip", "text");
    actAs(alice);
    const found = ok(
      await describeAssistantItems({
        items: [
          { type: "note", id: mine },
          { type: "note", id: others },
        ],
      }),
    );
    expect(found).toEqual([{ type: "note", id: mine, title: "My chip" }]);
    const picked = ok(await findAssistantItems({ query: "chip" }));
    expect(picked.map((p) => p.id)).toEqual([mine]);
  });
});

describe("the tools themselves", () => {
  function tools(who: TestUser, scope: Parameters<typeof createAssistantTools>[0]["scope"] = null) {
    const emitted: Proposal[] = [];
    const registry = new SourceRegistry();
    return {
      emitted,
      registry,
      tools: createAssistantTools({
        userId: who.id,
        prefs: { timezone: "Asia/Kolkata", startOfDay: "06:00" },
        scope,
        registry,
        emitProposal: (p) => emitted.push(p),
      }),
    };
  }

  it("never read another person's item, even given its id", async () => {
    const others = await note(bob, "Bob only Quokkazilla", "Bob's Quokkazilla text.");
    const { tools: t, registry } = tools(alice);
    const result = await t.getItem!.execute({ type: "note", id: others });
    expect(result.text).toBe("That item is not available.");
    expect(registry.all).toEqual([]);
    expect((await t.getItem!.execute({ type: "note", id: "not-a-uuid" })).text).toBe(
      "That item is not available.",
    );
    const search = await t.searchWorkspace!.execute({ query: "Quokkazilla" });
    expect(search.text).toBe("No items matched.");
  });

  it("only propose changes to the person's own tasks and notes", async () => {
    actAs(bob);
    const theirs = ok(await createTask({ title: "Bob's task" })).id;
    const { tools: t, emitted } = tools(alice);
    const refused = await t.proposeTaskChanges!.execute({
      kind: "updateTasks",
      changes: [{ taskId: theirs, set: { priority: "HIGH" } }],
    });
    expect(refused.text).toContain("not one of the person's items");
    const malformed = await t.proposeTaskChanges!.execute({
      kind: "createTasks",
      items: [{ title: "" }],
    });
    expect(malformed.text).toContain("not valid");
    const empty = await t.proposeTaskChanges!.execute({ kind: "updateTasks", changes: [] });
    expect(empty.text).toContain("not valid");
    expect(emitted).toEqual([]);
  });

  it("stay inside a scope, including proposals", async () => {
    actAs(alice);
    const inside = ok(await createTask({ title: "Inside task" })).id;
    const outside = ok(await createTask({ title: "Outside task" })).id;
    const { tools: t, emitted } = tools(alice, {
      note: new Set(),
      task: new Set([inside]),
      project: new Set(),
    });
    expect((await t.getItem!.execute({ type: "task", id: outside })).text).toBe(
      "That item is not available.",
    );
    expect((await t.getItem!.execute({ type: "task", id: inside })).items).toHaveLength(1);
    const reach = await t.proposeTaskChanges!.execute({
      kind: "updateTasks",
      changes: [{ taskId: outside, set: { priority: "HIGH" } }],
    });
    expect(reach.text).toContain("outside the items");
    expect(emitted).toEqual([]);
  });
});

describe("proposals: nothing changes until the person confirms", () => {
  it("turns a note into suggested tasks, then creates exactly the ticked rows once, with one audit row", async () => {
    const source = await note(
      alice,
      "Meeting notes",
      "We need to send the agenda. Priya will book the venue. Someone should review the budget.",
    );
    actAs(alice);
    const before = await taskCount(alice.id);
    const list = await events(
      await ask("turn this note into tasks", { contexts: [{ type: "note", id: source }] }),
    );
    const [proposal] = proposalsOf(list);
    expect(proposal?.kind).toBe("createTasks");
    if (proposal?.kind !== "createTasks") throw new Error("expected createTasks");
    expect(proposal.items.length).toBeGreaterThanOrEqual(2);
    expect(proposal.items[0]).toMatchObject({ linkNoteId: source, linkNoteTitle: "Meeting notes" });
    // The assistant said it only suggested, and nothing was written.
    expect(textOf(list)).toContain("nothing changes until you confirm");
    expect(await taskCount(alice.id)).toBe(before);
    expect(await audits(alice.id)).toEqual([]);

    // The person unticks one row and edits a title: only those rows come back.
    const kept = proposal.items.slice(0, 2).map((item, i) => ({
      title: i === 0 ? "Edited title" : item.title,
      dueDate: null,
      priority: "HIGH" as const,
      projectId: null,
      linkNoteId: item.linkNoteId,
    }));
    actAs(alice);
    const result = ok(
      await applyAssistantProposal({ proposalId: proposal.id, kind: "createTasks", items: kept }),
    );
    expect(result.applied).toBe(2);
    expect(result.createdIds).toHaveLength(2);
    const made = await db.select().from(tasks).where(eq(tasks.userId, alice.id));
    expect(made.length).toBe(before + 2);
    expect(made.map((t) => t.title)).toContain("Edited title");
    expect(made.find((t) => t.title === "Edited title")?.priority).toBe("HIGH");
    const links = await db.select().from(taskNotes).where(eq(taskNotes.noteId, source));
    expect(links).toHaveLength(2);

    const [row, ...rest] = await audits(alice.id);
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      source: "ASSISTANT",
      action: "tasks.create",
      proposalId: proposal.id,
    });
    expect(row!.summary).toBe("Created 2 tasks");
    expect(row!.entityRefs.filter((r) => r.type === "task")).toHaveLength(2);
    // No content: not the note's text, not a title.
    expect(JSON.stringify(row)).not.toMatch(/agenda|venue|Edited title|Meeting/);

    // A second apply (a double click, another tab) is refused and creates nothing more.
    actAs(alice);
    const again = await applyAssistantProposal({
      proposalId: proposal.id,
      kind: "createTasks",
      items: kept,
    });
    expect(errorOf(again).code).toBe("CONFLICT");
    expect(await taskCount(alice.id)).toBe(before + 2);
  });

  it("applies a reschedule suggestion through the task commands", async () => {
    const person = await createTestUser("reschedule-assistant");
    actAs(person);
    const late = ok(await createTask({ title: "Late one", dueDate: addDays(today(), -4) }));
    const list = await events(await ask("reschedule my overdue tasks"));
    const [proposal] = proposalsOf(list);
    expect(proposal?.kind).toBe("updateTasks");
    if (proposal?.kind !== "updateTasks") throw new Error("expected updateTasks");
    const change = proposal.changes[0]!;
    // Before → after, from the database: never from the model.
    expect(change).toMatchObject({ taskId: late.id, title: "Late one" });
    expect(change.before.dueDate).toBe(addDays(today(), -4));
    expect(change.set.dueDate).toBe(addDays(today(), 1));
    expect((await db.select().from(tasks).where(eq(tasks.id, late.id)))[0]!.dueDate).toBe(
      addDays(today(), -4),
    );

    actAs(person);
    const result = ok(
      await applyAssistantProposal({
        proposalId: proposal.id,
        kind: "updateTasks",
        changes: [{ taskId: late.id, set: { dueDate: addDays(today(), 1) } }],
      }),
    );
    expect(result.applied).toBe(1);
    expect((await db.select().from(tasks).where(eq(tasks.id, late.id)))[0]!.dueDate).toBe(
      addDays(today(), 1),
    );
    expect((await audits(person.id))[0]?.summary).toBe("Updated 1 task");
  });

  it("links notes to tasks, and refuses ids that are not theirs without changing anything", async () => {
    const person = await createTestUser("link-assistant");
    const mine = await note(person, "Link target", "text");
    const theirs = await note(bob, "Bob's note", "text");
    actAs(person);
    const task = ok(await createTask({ title: "Link me" })).id;

    const refused = await applyAssistantProposal({
      proposalId: "link-proposal-1",
      kind: "linkNotes",
      links: [{ taskId: task, noteId: theirs }],
    });
    expect(errorOf(refused).code).toBe("VALIDATION_ERROR");
    expect(await db.select().from(taskNotes).where(eq(taskNotes.taskId, task))).toEqual([]);
    // The failed attempt did not use up the proposal id.
    expect(await audits(person.id)).toEqual([]);

    actAs(person);
    const done = ok(
      await applyAssistantProposal({
        proposalId: "link-proposal-1",
        kind: "linkNotes",
        links: [{ taskId: task, noteId: mine }],
      }),
    );
    expect(done.applied).toBe(1);
    expect((await audits(person.id))[0]?.summary).toBe("Linked 1 note to tasks");
  });

  it("creating tasks is all or nothing, and rejects a note or project that is not theirs", async () => {
    const person = await createTestUser("atomic-assistant");
    const theirs = await note(bob, "Bob note", "text");
    actAs(person);
    const before = await taskCount(person.id);
    const result = await applyAssistantProposal({
      proposalId: "atomic-proposal-1",
      kind: "createTasks",
      items: [
        { title: "Fine task", linkNoteId: null },
        { title: "Bad link", linkNoteId: theirs },
      ],
    });
    expect(result.ok).toBe(false);
    expect(await taskCount(person.id)).toBe(before);
    expect(await audits(person.id)).toEqual([]);
  });

  it("validates what comes back from the browser like any other input", async () => {
    actAs(alice);
    for (const body of [
      {},
      { proposalId: "x", kind: "createTasks", items: [] },
      {
        proposalId: "long-enough-id",
        kind: "createTasks",
        items: [{ title: "ok" }],
        userId: alice.id,
      },
      {
        proposalId: "long-enough-id",
        kind: "updateTasks",
        changes: [{ taskId: "bad", set: { priority: "HIGH" } }],
      },
      {
        proposalId: "long-enough-id",
        kind: "updateTasks",
        changes: [{ taskId: "0192b6a0-0000-7000-8000-00000000cccc", set: {} }],
      },
    ]) {
      expect(errorOf(await applyAssistantProposal(body)).code).toBe("VALIDATION_ERROR");
    }
    actAs(null);
    expect(
      errorOf(
        await applyAssistantProposal({
          proposalId: "long-enough-id",
          kind: "linkNotes",
          links: [],
        }),
      ).code,
    ).toBe("UNAUTHENTICATED");
  });
});

describe("limits and failure", () => {
  it("rate-limits with a wait, and a failed turn leaves the workspace unchanged", async () => {
    const person = await createTestUser("limit-assistant");
    await note(person, "Limit note", "Something about limits.");
    actAs(person);
    const before = await taskCount(person.id);
    const failed = await events(await ask("anything [mock:error]"));
    expect(failed.some((e) => e.type === "error")).toBe(true);
    expect(failed.at(-1)).toMatchObject({ type: "error" });
    expect((await usage(person.id))[0]?.status).toBe("PROVIDER_ERROR");
    expect(await taskCount(person.id)).toBe(before);
    expect(await audits(person.id)).toEqual([]);

    for (let i = 0; i < 9; i += 1) await (await ask("limits please")).text();
    const blocked = await ask("limits please");
    expect(blocked.status).toBe(429);
    const body = await json(blocked);
    expect(body.error?.code).toBe("RATE_LIMITED");
    expect(body.error?.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("Ask AI about a selection", () => {
  it("answers from the selection and records usage without text", async () => {
    const person = await createTestUser("ask-selection");
    const id = await note(
      person,
      "Plan",
      "We ship on Friday. The owner is Priya. Budget is fixed.",
    );
    actAs(person);
    const response = await post(askSelection, {
      ownerType: "note",
      ownerId: id,
      selection: "We ship on Friday. The owner is Priya.",
      question: "Who is the owner?",
    });
    expect(response.status).toBe(200);
    const list = await events(response);
    expect(textOf(list)).toContain("Priya");
    const rows = await usage(person.id);
    expect(rows[0]).toMatchObject({
      feature: "ASK_SELECTION",
      status: "SUCCESS",
      promptVersion: "ASK_SELECTION_V1",
    });
    expect(JSON.stringify(rows)).not.toContain("Priya");
  });

  it("works for a task, refuses another person's item and bad input, and writes nothing", async () => {
    const person = await createTestUser("ask-selection-2");
    actAs(person);
    const task = ok(await createTask({ title: "Ship it" })).id;
    const others = await note(bob, "Bob note", "private");
    const good = {
      ownerType: "task",
      ownerId: task,
      selection: "ship it today",
      question: "explain this",
    };
    actAs(person);
    expect((await post(askSelection, good)).status).toBe(200);
    for (const body of [
      { ...good, ownerType: "note", ownerId: others },
      { ...good, ownerId: "0192b6a0-0000-7000-8000-00000000dddd" },
    ]) {
      actAs(person);
      const response = await post(askSelection, body);
      expect(response.status).toBe(404);
    }
    for (const body of [
      { ...good, selection: "" },
      { ...good, question: "?" },
      { ...good, selection: "x".repeat(6001) },
      { ...good, extra: 1 },
    ]) {
      actAs(person);
      expect((await post(askSelection, body)).status).toBe(400);
    }
    actAs(null);
    expect((await post(askSelection, good)).status).toBe(401);
  });
});

describe("Update with AI (a custom instruction)", () => {
  it("rewrites only the selection with the person's instruction", async () => {
    const person = await createTestUser("update-ai");
    actAs(person);
    const list = await events(
      await post(editSelection, {
        mode: "CUSTOM",
        text: "we ship friday",
        instruction: "make it formal",
      }),
    );
    expect(textOf(list)).toBe("we ship friday (make it formal)");
    expect((await usage(person.id))[0]).toMatchObject({
      feature: "EDIT_SELECTION",
      promptVersion: "EDIT_SELECTION_V2",
    });
  });

  it("needs an instruction for CUSTOM, and refuses one for the other modes", async () => {
    actAs(alice);
    for (const body of [
      { mode: "CUSTOM", text: "hello" },
      { mode: "CUSTOM", text: "hello", instruction: "x".repeat(501) },
      { mode: "CUSTOM", text: "", instruction: "shorter" },
      { mode: "IMPROVE", text: "hello", instruction: "shorter" },
    ]) {
      expect((await post(editSelection, body)).status).toBe(400);
    }
  });
});

describe("related items", () => {
  it("lists what shares words, never itself, what is already linked, or other people's items", async () => {
    const person = await createTestUser("related-assistant");
    const main = await note(
      person,
      "Checkout login failures",
      "Users hit login failures with OTP during checkout.",
    );
    const similar = await note(
      person,
      "OTP login incidents",
      "Several login failures with OTP codes were seen at checkout.",
    );
    const linked = await note(
      person,
      "Checkout failures log",
      "Login failures with OTP during checkout again.",
    );
    await note(person, "Gardening", "Tomatoes and basil.");
    await note(bob, "Bob login failures", "login failures with OTP checkout");
    actAs(person);
    const task = ok(await createTask({ title: "Fix OTP login failures at checkout" })).id;
    ok(await linkTaskNote({ taskId: task, noteId: linked }));

    const forNote = ok(await getRelatedItems({ type: "note", id: main }));
    expect(forNote.map((r) => r.id)).toEqual(expect.arrayContaining([similar, linked, task]));
    expect(forNote.map((r) => r.id)).not.toContain(main);
    expect(forNote.some((r) => r.title.includes("Bob") || r.title === "Gardening")).toBe(false);
    expect(forNote.find((r) => r.id === similar)?.reason).toMatch(/^Mentions “/);

    // The task's own panel leaves out the note already linked to it.
    const forTask = ok(await getRelatedItems({ type: "task", id: task }));
    expect(forTask.map((r) => r.id)).not.toContain(linked);
    expect(forTask.map((r) => r.id)).not.toContain(task);

    // Someone else's id is an empty list, not an error that reveals it exists.
    actAs(alice);
    expect(ok(await getRelatedItems({ type: "note", id: main }))).toEqual([]);
  });

  it("is hidden when AI is off", async () => {
    const off = await createTestUser("related-off");
    await setPreferences(off.id, { aiEnabled: false });
    actAs(off);
    const id = await note(off, "Anything", "text");
    expect(errorOf(await getRelatedItems({ type: "note", id })).code).toBe("AI_DISABLED");
  });
});

it("keeps the audit log's source and summary constraints", async () => {
  await expect(
    db.insert(auditLog).values({
      userId: alice.id,
      source: "SOMETHING",
      action: "x",
      proposalId: "constraint-1",
      summary: "ok",
    }),
  ).rejects.toThrow();
  await expect(
    db.insert(auditLog).values({
      userId: alice.id,
      source: "ASSISTANT",
      action: "x",
      proposalId: "constraint-2",
      summary: "s".repeat(201),
    }),
  ).rejects.toThrow();
  expect(
    await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.userId, alice.id), eq(auditLog.proposalId, "constraint-1"))),
  ).toEqual([]);
});
