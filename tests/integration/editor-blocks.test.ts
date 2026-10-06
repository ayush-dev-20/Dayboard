import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createNote, saveNoteContent } from "@/actions/notes";
import { createTask, updateTaskDescription } from "@/actions/tasks";
import { db } from "@/db/client";
import { getNote } from "@/db/queries/notes";
import { getTaskDetail } from "@/db/queries/tasks";
import { notes, tasks } from "@/db/schema";
import { actAs, createTestUser, errorOf, ok, type TestUser } from "./harness";

// V2 feature 01: the new blocks are saved, projected to text on the server, and refused when
// they break the limits. Notes and task descriptions share one schema, so both are covered.

let alice: TestUser;

beforeAll(async () => {
  alice = await createTestUser("alice-blocks");
});

const text = (value: string) => ({ type: "text", text: value });
const p = (value: string) => ({ type: "paragraph", content: [text(value)] });
const cell = (value: string, type = "tableCell") => ({ type, content: [p(value)] });
const doc = (...content: unknown[]) => ({ type: "doc", content });

const blocks = doc(
  {
    type: "callout",
    attrs: { emoji: "💡", tone: "info" },
    content: [p("Remember the budget")],
  },
  {
    type: "toggle",
    attrs: { id: "abc123" },
    content: [
      { type: "toggleSummary", attrs: { level: 0 }, content: [text("Details")] },
      { type: "toggleContent", content: [p("hidden body")] },
    ],
  },
  {
    type: "table",
    content: [
      { type: "tableRow", content: [cell("Name", "tableHeader"), cell("Cost", "tableHeader")] },
      { type: "tableRow", content: [cell("Desk"), cell("200")] },
    ],
  },
  { type: "tableOfContents" },
);

const expectedText = "Remember the budget\nDetails\nhidden body\nName Cost\nDesk 200";

function wideTable(columns: number) {
  const cells = Array.from({ length: columns }, (_, i) => cell(String(i)));
  return doc({ type: "table", content: [{ type: "tableRow", content: cells }] });
}

describe("notes", () => {
  it("saves the new blocks, round-trips them and builds the text copy on the server", async () => {
    actAs(alice);
    const created = ok(await createNote({ title: "Blocks", contentJson: blocks }));
    const [raw] = await db.select().from(notes).where(eq(notes.id, created.id));
    expect(raw?.contentText).toBe(expectedText);
    expect((await getNote(alice.id, created.id))?.contentJson).toEqual(blocks);

    const saved = ok(
      await saveNoteContent({
        id: created.id,
        contentJson: doc(...blocks.content, p("one more")),
        baseVersion: created.version,
      }),
    );
    expect(saved.outcome).toBe("saved");
    const [after] = await db.select().from(notes).where(eq(notes.id, created.id));
    expect(after?.contentText).toBe(`${expectedText}\none more`);
  });

  it("refuses a table past the column limit and a toggle without a body", async () => {
    actAs(alice);
    expect(errorOf(await createNote({ title: "Wide", contentJson: wideTable(11) })).code).toBe(
      "VALIDATION_ERROR",
    );
    ok(await createNote({ title: "Ten", contentJson: wideTable(10) }));

    const broken = doc({
      type: "toggle",
      attrs: { id: "abc456" },
      content: [{ type: "toggleSummary", attrs: { level: 0 }, content: [text("No body")] }],
    });
    expect(errorOf(await createNote({ title: "Broken", contentJson: broken })).code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("refuses a structural block where it is not allowed", async () => {
    actAs(alice);
    const nested = doc({
      type: "blockquote",
      content: [{ type: "table", content: [{ type: "tableRow", content: [cell("x")] }] }],
    });
    expect(errorOf(await createNote({ title: "Nested", contentJson: nested })).code).toBe(
      "VALIDATION_ERROR",
    );
  });
});

describe("task descriptions", () => {
  it("take the same blocks, with the text copy built on the server", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Plan the move" }));
    ok(await updateTaskDescription({ id: task.id, descriptionJson: blocks }));
    const [raw] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(raw?.descriptionText).toBe(expectedText);
    expect((await getTaskDetail(alice.id, task.id))?.descriptionJson).toEqual(blocks);
  });

  it("refuse the same invalid documents", async () => {
    actAs(alice);
    const task = ok(await createTask({ title: "Too wide" }));
    expect(
      errorOf(await updateTaskDescription({ id: task.id, descriptionJson: wideTable(11) })).code,
    ).toBe("VALIDATION_ERROR");
    const [raw] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(raw?.descriptionJson).toBeNull();
  });
});
