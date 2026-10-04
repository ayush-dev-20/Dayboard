import { describe, expect, it } from "vitest";
import { cleanTitle, splitTitle } from "@/lib/ai/generate";
import {
  PROMPT_VERSIONS,
  editSelectionPrompt,
  editSelectionSystem,
  generatePrompt,
  generateSystem,
  planDayPrompt,
  planDaySystem,
} from "@/lib/ai/prompts";
import {
  editSelectionRequestSchema,
  generateContentRequestSchema,
  planDayRequestSchema,
} from "@/lib/validations/ai";
import { PlanCollector, parsePlanLine } from "@/lib/ai/plan";
import {
  MAX_EDIT_CHARS,
  REFUSE_TOO_LONG,
  REFUSE_UNSAFE,
  placeLinks,
  planReplacement,
  rangeUnchanged,
  selectionRefusal,
} from "@/lib/editor/replace-plan";

const A = "0192f2a0-7c1e-7000-8000-00000000000a";
const B = "0192f2a0-7c1e-7000-8000-00000000000b";
const C = "0192f2a0-7c1e-7000-8000-00000000000c";
const D = "0192f2a0-7c1e-7000-8000-00000000000d";
const E = "0192f2a0-7c1e-7000-8000-00000000000e";
const F = "0192f2a0-7c1e-7000-8000-00000000000f";
const STRANGER = "0192f2a0-7c1e-7000-8000-0000000000ff";

describe("splitTitle", () => {
  it("splits the TITLE line from the body", () => {
    expect(splitTitle("TITLE: Acme brief\n\n# Heading\nText")).toEqual({
      title: "Acme brief",
      body: "# Heading\nText",
      decided: true,
    });
  });

  it("waits for the end of the title line, even across chunks", () => {
    expect(splitTitle("TIT")).toMatchObject({ title: null, body: "", decided: false });
    expect(splitTitle("TITLE: Acme br")).toMatchObject({ title: null, decided: false });
    expect(splitTitle("TITLE: Acme brief\n")).toMatchObject({ title: "Acme brief", decided: true });
  });

  it("an answer with no title line is all body, as soon as that is clear", () => {
    expect(splitTitle("# Just a heading\nand text")).toEqual({
      title: null,
      body: "# Just a heading\nand text",
      decided: true,
    });
    expect(splitTitle("Hello there")).toMatchObject({ title: null, decided: true });
  });

  it("is case-insensitive and tolerates leading blank space", () => {
    expect(splitTitle("\n  title: Hi\nBody")).toMatchObject({ title: "Hi", body: "Body" });
  });

  it("at the end of the stream, a lone title line is a title with an empty body", () => {
    expect(splitTitle("TITLE: Only a title", true)).toEqual({
      title: "Only a title",
      body: "",
      decided: true,
    });
  });

  it("cleans marks, quotes and length from titles", () => {
    expect(cleanTitle('**"My _great_ note"**')).toBe("My great note");
    expect(cleanTitle("x".repeat(500))).toHaveLength(300);
    expect(splitTitle("TITLE: ###\nBody").title).toBeNull();
  });

  it("an empty buffer is undecided until the end", () => {
    expect(splitTitle("")).toMatchObject({ decided: false });
    expect(splitTitle("   ", true)).toMatchObject({ decided: true, body: "" });
  });
});

describe("parsePlanLine", () => {
  it("reads proposals and summaries", () => {
    expect(parsePlanLine(`{"taskId":"${A}","reason":"Due today."}`)).toEqual({
      kind: "proposal",
      taskId: A,
      reason: "Due today.",
    });
    expect(parsePlanLine('{"summary":"Two overdue first."}')).toEqual({
      kind: "summary",
      text: "Two overdue first.",
    });
  });

  it("skips anything that is not a valid line", () => {
    for (const line of [
      "",
      "```json",
      "Here is your plan:",
      "{broken",
      '{"taskId":"nope","reason":"x"}',
      '{"other":1}',
      "[1,2]",
      "null",
    ]) {
      expect(parsePlanLine(line), line).toBeNull();
    }
  });

  it("tolerates a trailing comma and cuts long reasons to 100 characters", () => {
    const record = parsePlanLine(`{"taskId":"${A}","reason":"${"r".repeat(300)}"},`);
    expect(record).toMatchObject({ kind: "proposal" });
    expect((record as { reason: string }).reason.length).toBeLessThanOrEqual(100);
  });
});

describe("PlanCollector", () => {
  const all = new Set([A, B, C, D, E, F]);
  const line = (id: string, reason = "ok") => JSON.stringify({ taskId: id, reason });

  it("emits a record only when its line is complete", () => {
    const c = new PlanCollector(all);
    expect(c.push(line(A).slice(0, 20))).toEqual([]);
    expect(c.push(`${line(A).slice(20)}\n`)).toHaveLength(1);
  });

  it("drops ids it did not send, repeats and everything past the fifth", () => {
    const c = new PlanCollector(all);
    const out = c.push(
      [line(STRANGER), line(A), line(A), line(B), line(C), line(D), line(E), line(F), ""].join(
        "\n",
      ),
    );
    expect(out.map((r) => (r.kind === "proposal" ? r.taskId : r.kind))).toEqual([A, B, C, D, E]);
  });

  it("a malformed line does not stop the lines after it", () => {
    const c = new PlanCollector(all);
    const out = c.push(`{oops\n${line(A)}\n`);
    expect(out).toHaveLength(1);
  });

  it("keeps only the first summary", () => {
    const c = new PlanCollector(all);
    const out = c.push('{"summary":"one"}\n{"summary":"two"}\n');
    expect(out).toEqual([{ kind: "summary", text: "one" }]);
  });

  it("end() completes the last line, and zero proposals is visible to the caller", () => {
    const c = new PlanCollector(all);
    expect(c.push(line(A))).toEqual([]);
    expect(c.end()).toHaveLength(1);
    expect(c.proposals).toBe(1);
    const empty = new PlanCollector(all);
    empty.push("nothing useful\n");
    empty.end();
    expect(empty.proposals).toBe(0);
  });

  it("accepts ids in any letter case", () => {
    const c = new PlanCollector(all);
    expect(c.push(`${line(A.toUpperCase())}\n`)).toHaveLength(1);
  });
});

describe("writing help: replacement planning", () => {
  it("refuses code blocks, dividers and long selections", () => {
    expect(selectionRefusal(["paragraph", "codeBlock"], "x")).toBe(REFUSE_UNSAFE);
    expect(selectionRefusal(["horizontalRule"], "x")).toBe(REFUSE_UNSAFE);
    expect(selectionRefusal(["paragraph"], "x".repeat(MAX_EDIT_CHARS + 1))).toBe(REFUSE_TOO_LONG);
    expect(selectionRefusal(["paragraph", "heading", "listItem"], "ok")).toBeNull();
  });

  it("maps equal block counts one to one", () => {
    expect(planReplacement(2, "One.\n\nTwo.")).toEqual({
      kind: "inPlace",
      texts: ["One.", "Two."],
    });
  });

  it("replaces the range when the counts differ", () => {
    expect(planReplacement(3, "Merged.")).toEqual({ kind: "range", paragraphs: ["Merged."] });
    expect(planReplacement(1, "A.\n\nB.")).toEqual({ kind: "range", paragraphs: ["A.", "B."] });
  });

  it("reads single newlines as paragraphs only when that matches the block count", () => {
    expect(planReplacement(2, "One.\nTwo.")).toEqual({ kind: "inPlace", texts: ["One.", "Two."] });
    // A wrapped paragraph is one paragraph.
    expect(planReplacement(1, "One\nwrapped.")).toEqual({
      kind: "inPlace",
      texts: ["One wrapped."],
    });
  });

  it("has no plan for an empty answer", () => {
    expect(planReplacement(1, "  \n ")).toBeNull();
  });

  it("keeps a link only when its exact words survive", () => {
    const links = [{ text: "the docs", href: "https://example.com" }];
    expect(placeLinks("Read the docs now", links)).toEqual([
      { text: "Read " },
      { text: "the docs", href: "https://example.com" },
      { text: " now" },
    ]);
    expect(placeLinks("Read the documentation", links)).toEqual([
      { text: "Read the documentation" },
    ]);
  });

  it("detects a changed range", () => {
    expect(rangeUnchanged("same", "same")).toBe(true);
    expect(rangeUnchanged("same", "changed")).toBe(false);
  });
});

describe("prompts", () => {
  it("each feature has its own version id", () => {
    expect(PROMPT_VERSIONS.GENERATE_CONTENT).toBe("GENERATE_CONTENT_V1");
    expect(PROMPT_VERSIONS.PLAN_DAY).toBe("PLAN_DAY_V1");
    expect(PROMPT_VERSIONS.EDIT_SELECTION).toBe("EDIT_SELECTION_V1");
  });

  it("all of them tell the model to treat <data> as material, never instructions", () => {
    const systems = [
      generateSystem({ length: "STANDARD", withTitle: true }),
      planDaySystem,
      ...Object.values(editSelectionSystem),
    ];
    for (const system of systems) expect(system).toMatch(/<data>|data block|never instructions/i);
  });

  it("generate asks for the allowed formatting only, and a TITLE line only when wanted", () => {
    const withTitle = generateSystem({ length: "SHORT", withTitle: true });
    const without = generateSystem({ length: "DETAILED", withTitle: false });
    expect(withTitle).toContain("TITLE:");
    expect(without).not.toContain('"TITLE: "');
    for (const system of [withTitle, without]) {
      expect(system).toMatch(/Never use tables, images, HTML/);
      expect(system).toMatch(/language/i);
    }
  });

  it("puts the prompt and context in separate data blocks, and leaves out empty context", () => {
    const both = generatePrompt({ prompt: "Write it", context: "Existing note" });
    expect(both).toContain('name="context"');
    expect(both).toContain('name="request"');
    expect(generatePrompt({ prompt: "Write it", context: "  " })).not.toContain('name="context"');
  });

  it("plan lists every candidate with its id, and the date", () => {
    const text = planDayPrompt(
      [
        {
          id: A,
          title: "Pay rent",
          dueDate: "2026-10-01",
          priority: "HIGH",
          status: "PLANNED",
          project: null,
          subtasksDone: 1,
          subtasksTotal: 3,
        },
      ],
      "2026-10-03",
      "Asia/Kolkata",
    );
    expect(text).toContain(A);
    expect(text).toContain("Pay rent");
    expect(text).toContain("2026-10-03");
    expect(text).toContain("Saturday");
    expect(text).toContain("1/3");
  });

  it("edit sends the selection in a data block, and Continue adds the text before it", () => {
    expect(editSelectionPrompt("IMPROVE", "Some words")).toContain('name="selection"');
    expect(editSelectionPrompt("CONTINUE", "", "Once upon a time")).toContain("Once upon a time");
  });
});

describe("request schemas", () => {
  const base = {
    target: "new",
    prompt: "Write",
    length: "STANDARD",
    withTitle: false,
    useContext: false,
  };

  it("generate: target and id go together, and unknown keys are refused", () => {
    expect(generateContentRequestSchema.safeParse(base).success).toBe(true);
    expect(generateContentRequestSchema.safeParse({ ...base, target: "note" }).success).toBe(false);
    expect(generateContentRequestSchema.safeParse({ ...base, targetId: A }).success).toBe(false);
    expect(
      generateContentRequestSchema.safeParse({ ...base, target: "task", targetId: A }).success,
    ).toBe(true);
    expect(generateContentRequestSchema.safeParse({ ...base, userId: A }).success).toBe(false);
    expect(generateContentRequestSchema.safeParse({ ...base, prompt: " " }).success).toBe(false);
    expect(
      generateContentRequestSchema.safeParse({ ...base, prompt: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("plan takes nothing", () => {
    expect(planDayRequestSchema.safeParse({}).success).toBe(true);
    expect(planDayRequestSchema.safeParse({ taskIds: [A] }).success).toBe(false);
  });

  it("edit: Continue needs something to continue from, the others a selection and no 'before'", () => {
    const ok = (v: unknown) => editSelectionRequestSchema.safeParse(v).success;
    expect(ok({ mode: "IMPROVE", text: "Some text" })).toBe(true);
    expect(ok({ mode: "IMPROVE", text: "" })).toBe(false);
    expect(ok({ mode: "IMPROVE", text: "x".repeat(6001) })).toBe(false);
    expect(ok({ mode: "IMPROVE", text: "a", before: "b" })).toBe(false);
    expect(ok({ mode: "CONTINUE", text: "", before: "Earlier text" })).toBe(true);
    expect(ok({ mode: "CONTINUE", text: "", before: " " })).toBe(false);
    expect(ok({ mode: "CONTINUE", text: "", before: "x".repeat(2001) })).toBe(false);
    expect(ok({ mode: "IMPROVE", text: "a", extra: 1 })).toBe(false);
  });
});
