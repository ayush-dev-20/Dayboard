import { describe, expect, it } from "vitest";
import { COLOR_TOKENS, colorVar } from "@/lib/colors";
import { formatCompact } from "@/lib/dates/relative";
import { isEmptyDoc, toPlainText } from "@/lib/editor/projection";
import type { TiptapDoc } from "@/lib/editor/types";
import { makeSnippet, SNIPPET_LENGTH } from "@/lib/notes/dto";
import { buildNotesQuery, hasNoteFilters, parseNotesParams } from "@/lib/notes/params";
import {
  INITIAL_SAVE_STATE,
  noteSaveReducer,
  retryDelayMs,
  saveLabel,
  type NoteSaveEvent,
  type NoteSaveState,
} from "@/lib/notes/save-state";
import { projectProgress } from "@/lib/projects/progress";
import { pickerRank } from "@/lib/projects/status";
import { cleanTagName, normalizeTagName } from "@/lib/tags";
import { createTagSchema, setTagsSchema } from "@/lib/validations/tags";
import { createProjectSchema } from "@/lib/validations/projects";

describe("tag names", () => {
  it("normalizes by trimming, lower-casing and collapsing inner spaces", () => {
    expect(normalizeTagName("  Client   Work ")).toBe("client work");
    expect(normalizeTagName("WORK")).toBe(normalizeTagName("work"));
    expect(normalizeTagName("a\tb\n c")).toBe("a b c");
  });

  it("keeps the person's casing for display, with spaces tidied", () => {
    expect(cleanTagName("  Client   Work ")).toBe("Client Work");
  });

  it("treats names that differ only by case or spacing as the same tag (the uniqueness rule)", () => {
    const names = ["Client", "client", " CLIENT ", "Client  Work", "client work"];
    expect(new Set(names.map(normalizeTagName)).size).toBe(2);
  });

  it("validates length after tidying, and caps the set at 10 without duplicates", () => {
    expect(createTagSchema.safeParse({ name: "   " }).success).toBe(false);
    expect(createTagSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
    expect(createTagSchema.parse({ name: "  a   b " }).name).toBe("a b");
    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
    expect(setTagsSchema.parse({ id, tagIds: [id, id] }).tagIds).toEqual([id]);
    const eleven = Array.from(
      { length: 11 },
      (_, i) => `0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a${String(i).padStart(2, "0")}`,
    );
    expect(setTagsSchema.safeParse({ id, tagIds: eleven }).success).toBe(false);
  });
});

describe("project progress", () => {
  it("is completed ÷ (total − cancelled), as a whole-number percentage", () => {
    expect(projectProgress({ done: 5, cancelled: 0, total: 12 })).toEqual({
      percent: 42,
      done: 5,
      counted: 12,
    });
    expect(projectProgress({ done: 1, cancelled: 0, total: 3 }).percent).toBe(33);
    expect(projectProgress({ done: 2, cancelled: 0, total: 3 }).percent).toBe(67);
  });

  it("leaves cancelled items out of the denominator", () => {
    expect(projectProgress({ done: 2, cancelled: 2, total: 4 })).toEqual({
      percent: 100,
      done: 2,
      counted: 2,
    });
    expect(projectProgress({ done: 1, cancelled: 1, total: 4 }).percent).toBe(33);
  });

  it("has no percentage (not 0%) when there is nothing to measure", () => {
    expect(projectProgress({ done: 0, cancelled: 0, total: 0 }).percent).toBeNull();
    // Everything cancelled is also "nothing to measure".
    expect(projectProgress({ done: 0, cancelled: 3, total: 3 }).percent).toBeNull();
  });

  it("is 0% only when there is work and none of it is done, and never above 100%", () => {
    expect(projectProgress({ done: 0, cancelled: 0, total: 4 }).percent).toBe(0);
    expect(projectProgress({ done: 9, cancelled: 0, total: 4 }).percent).toBe(100);
  });
});

describe("note save state machine", () => {
  const run = (events: NoteSaveEvent["type"][], from: NoteSaveState = INITIAL_SAVE_STATE) =>
    events.reduce((state, type) => noteSaveReducer(state, { type }), from);

  it("goes idle → saving → saved → idle", () => {
    expect(run(["edit", "start"])).toEqual({ phase: "saving" });
    expect(run(["edit", "start", "succeeded"])).toEqual({ phase: "saved" });
    expect(run(["edit", "start", "succeeded", "fade"])).toEqual({ phase: "idle" });
  });

  it("a failed save keeps counting attempts through retries, then succeeds", () => {
    const failed = run(["start", "failed"]);
    expect(failed).toEqual({ phase: "failed", attempts: 1 });
    expect(run(["start", "failed", "start", "failed"])).toEqual({ phase: "failed", attempts: 2 });
    expect(run(["start", "failed", "start", "succeeded"])).toEqual({ phase: "saved" });
  });

  it("typing while a save has failed doesn't hide the failure", () => {
    expect(run(["start", "failed", "edit"])).toEqual({ phase: "failed", attempts: 1 });
  });

  it("a conflict sticks until the person decides, whatever else happens", () => {
    const conflict = run(["start", "conflicted"]);
    expect(conflict).toEqual({ phase: "conflict" });
    expect(run(["edit", "start", "succeeded", "fade"], conflict)).toEqual({ phase: "conflict" });
    expect(run(["resolved"], conflict)).toEqual({ phase: "idle" });
    // Keep mine: resolved, then saving again.
    expect(run(["resolved", "start", "succeeded"], conflict)).toEqual({ phase: "saved" });
  });

  it("the 'Saved' fade only affects saved", () => {
    expect(run(["fade"], { phase: "saving" })).toEqual({ phase: "saving" });
    expect(run(["fade"], { phase: "failed", attempts: 2 })).toEqual({
      phase: "failed",
      attempts: 2,
    });
  });

  it("retries after 2s, 4s, 8s, 16s and then every 30s", () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs)).toEqual([
      2000, 4000, 8000, 16000, 30000, 30000, 30000,
    ]);
  });

  it("has words for saving, saved and failed, and none for the rest", () => {
    expect(saveLabel({ phase: "saving" })).toBe("Saving…");
    expect(saveLabel({ phase: "saved" })).toBe("Saved");
    expect(saveLabel({ phase: "failed", attempts: 1 })).toBe("Not saved, retrying");
    expect(saveLabel({ phase: "idle" })).toBeNull();
    expect(saveLabel({ phase: "conflict" })).toBeNull();
  });
});

describe("plain-text projection of every node type", () => {
  const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
  const doc = (...content: object[]) => ({ type: "doc", content }) as TiptapDoc;

  it("covers headings, paragraphs, marks, lists, checklists, quotes, code and rules", () => {
    const result = toPlainText(
      doc(
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Title" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: " and " },
            {
              type: "text",
              text: "link",
              marks: [{ type: "link", attrs: { href: "https://example.com" } }],
            },
          ],
        },
        {
          type: "bulletList",
          content: [
            { type: "listItem", content: [p("one")] },
            { type: "listItem", content: [p("two")] },
          ],
        },
        {
          type: "orderedList",
          attrs: { start: 3 },
          content: [
            { type: "listItem", content: [p("three")] },
            { type: "listItem", content: [p("four")] },
          ],
        },
        {
          type: "taskList",
          content: [
            { type: "taskItem", attrs: { checked: true }, content: [p("done")] },
            { type: "taskItem", attrs: { checked: false }, content: [p("todo")] },
          ],
        },
        { type: "blockquote", content: [p("quoted")] },
        { type: "codeBlock", content: [{ type: "text", text: "let a = 1;\nlet b = 2;" }] },
        { type: "horizontalRule" },
        p("end"),
      ),
    );
    expect(result).toBe(
      [
        "Title",
        "bold and link",
        "- one",
        "- two",
        "3. three",
        "4. four",
        "[x] done",
        "[ ] todo",
        "quoted",
        "let a = 1;",
        "let b = 2;",
        "end",
      ].join("\n"),
    );
  });

  it("handles hard breaks, nested lists and strikethrough and underline text", () => {
    const nested = doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            p("parent"),
            { type: "bulletList", content: [{ type: "listItem", content: [p("child")] }] },
          ],
        },
      ],
    });
    expect(toPlainText(nested)).toBe("- parent\n- child");
    const br = doc({
      type: "paragraph",
      content: [
        { type: "text", text: "a", marks: [{ type: "strike" }] },
        { type: "hardBreak" },
        { type: "text", text: "b", marks: [{ type: "underline" }] },
      ],
    });
    expect(toPlainText(br)).toBe("a\nb");
  });

  it("an empty document, or one with only empty paragraphs, has no text; a rule alone is not empty", () => {
    expect(toPlainText(doc())).toBe("");
    expect(isEmptyDoc(doc({ type: "paragraph" }, { type: "paragraph" }))).toBe(true);
    expect(isEmptyDoc(doc({ type: "horizontalRule" }))).toBe(false);
  });
});

describe("snippets and compact times", () => {
  it("collapses whitespace and cuts long text with an ellipsis", () => {
    expect(makeSnippet("  one \n\n two\tthree ")).toBe("one two three");
    const long = "word ".repeat(100);
    const snippet = makeSnippet(long);
    expect(snippet.length).toBeLessThanOrEqual(SNIPPET_LENGTH + 1);
    expect(snippet.endsWith("…")).toBe(true);
    expect(makeSnippet("")).toBe("");
  });

  const tz = "Asia/Kolkata";
  const now = new Date("2026-10-01T12:00:00Z"); // 17:30 in Kolkata
  const ago = (ms: number) => new Date(now.getTime() - ms);
  it("says now, minutes, hours, Yesterday, a weekday, then a date", () => {
    expect(formatCompact(ago(20_000), now, tz)).toBe("now");
    expect(formatCompact(ago(12 * 60_000), now, tz)).toBe("12m");
    expect(formatCompact(ago(2 * 3600_000), now, tz)).toBe("2h");
    expect(formatCompact(new Date("2026-09-30T10:00:00Z"), now, tz)).toBe("Yesterday");
    expect(formatCompact(new Date("2026-09-28T10:00:00Z"), now, tz)).toBe("Mon");
    expect(formatCompact(new Date("2026-09-19T10:00:00Z"), now, tz)).toBe("Sep 19");
    expect(formatCompact(new Date("2025-09-19T10:00:00Z"), now, tz)).toBe("Sep 19, 2025");
  });

  it("uses the person's own days: 23:00 UTC is already tomorrow in Kolkata", () => {
    const lateNow = new Date("2026-10-01T19:00:00Z"); // 00:30 Oct 2 in Kolkata
    expect(formatCompact(new Date("2026-10-01T10:00:00Z"), lateNow, tz)).toBe("Yesterday");
  });
});

describe("notes URL filters", () => {
  const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
  it("reads project, none and tag, ignores nonsense, and round-trips", () => {
    expect(parseNotesParams({ project: id, tag: id })).toEqual({ projectId: id, tagId: id });
    expect(parseNotesParams({ project: "none" }).projectId).toBe("none");
    expect(parseNotesParams({ project: "x", tag: "y" })).toEqual({ projectId: null, tagId: null });
    expect(buildNotesQuery({})).toBe("");
    const original = parseNotesParams({ project: "none", tag: id });
    expect(
      parseNotesParams(Object.fromEntries(new URLSearchParams(buildNotesQuery(original)))),
    ).toEqual(original);
    expect(hasNoteFilters(original)).toBe(true);
    expect(hasNoteFilters({ projectId: null, tagId: null })).toBe(false);
  });
});

describe("projects and colours", () => {
  it("accepts the eight colour tokens and nothing else", () => {
    expect(COLOR_TOKENS).toHaveLength(8);
    expect(createProjectSchema.safeParse({ name: "A", color: "teal" }).success).toBe(true);
    expect(createProjectSchema.safeParse({ name: "A", color: "#00ff00" }).success).toBe(false);
    expect(colorVar("teal")).toBe("var(--tag-teal)");
    expect(colorVar(null)).toBe("var(--tag-slate)");
  });

  it("trims names, rejects empty or long ones, and turns a blank description into null", () => {
    expect(createProjectSchema.parse({ name: "  Home  " }).name).toBe("Home");
    expect(createProjectSchema.safeParse({ name: "  " }).success).toBe(false);
    expect(createProjectSchema.safeParse({ name: "x".repeat(101) }).success).toBe(false);
    expect(createProjectSchema.parse({ name: "A", description: "   " }).description).toBeNull();
    expect(
      createProjectSchema.safeParse({ name: "A", description: "x".repeat(2001) }).success,
    ).toBe(false);
  });

  it("ranks active before on hold before the rest in pickers", () => {
    expect(pickerRank("ACTIVE")).toBeLessThan(pickerRank("ON_HOLD"));
    expect(pickerRank("ON_HOLD")).toBeLessThan(pickerRank("COMPLETED"));
    expect(pickerRank("COMPLETED")).toBeLessThan(pickerRank("ARCHIVED"));
  });
});
