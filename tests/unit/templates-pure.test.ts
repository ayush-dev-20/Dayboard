import { describe, expect, it } from "vitest";
import { EditorDocError } from "@/lib/editor/schema";
import type { TiptapDoc, TiptapNode } from "@/lib/editor/types";
import {
  applyPlaceholders,
  applyToTitle,
  type PlaceholderContext,
} from "@/lib/templates/placeholders";
import {
  FORBIDDEN_MESSAGE,
  isUsableTemplateDoc,
  sanitizeTemplateDoc,
} from "@/lib/templates/schema";
import { STARTERS, STARTER_KEYS, starterList } from "@/lib/templates/starters";

const para = (...content: TiptapNode[]): TiptapNode => ({ type: "paragraph", content });
const text = (value: string, marks?: TiptapNode["marks"]): TiptapNode => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const doc = (...content: TiptapNode[]): TiptapDoc => ({ type: "doc", content });

const ctx: PlaceholderContext = {
  day: "2026-10-13",
  now: new Date("2026-10-13T08:35:00.000Z"),
  timezone: "Asia/Kolkata",
  title: "Standup",
};
const textsOf = (d: TiptapDoc) =>
  (d.content ?? []).flatMap((n) => (n.content ?? []).map((c) => c.text));

describe("sanitizeTemplateDoc", () => {
  it("keeps what a note may hold: text, headings, lists, tasks, tables, toggles, callouts, links, quotes", () => {
    const rich = doc(
      { type: "heading", attrs: { level: 2 }, content: [text("Heading")] },
      para(text("Hello")),
      { type: "bulletList", content: [{ type: "listItem", content: [para(text("one"))] }] },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: false }, content: [para(text("do"))] }],
      },
      { type: "blockquote", content: [para(text("quote"))] },
      { type: "horizontalRule" },
    );
    expect(sanitizeTemplateDoc(rich).content).toHaveLength(6);
  });

  it("refuses an image, a file and a sub-note with one plain message", () => {
    const forbidden: TiptapNode[] = [
      { type: "image", attrs: { attachmentId: "01a10706-5c6c-71c5-8918-4a14691a0cfe" } },
      { type: "file", attrs: { attachmentId: "01a10706-5c6c-71c5-8918-4a14691a0cfe" } },
      { type: "subNote", attrs: { noteId: "01a10706-5c6c-71c5-8918-4a14691a0cfe" } },
    ];
    for (const node of forbidden) {
      expect(() => sanitizeTemplateDoc(doc(para(text("a")), node))).toThrowError(FORBIDDEN_MESSAGE);
    }
  });

  it("refuses one hidden inside a list or a toggle", () => {
    const nested = doc({
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            para(text("x")),
            { type: "image", attrs: { attachmentId: "01a10706-5c6c-71c5-8918-4a14691a0cfe" } },
          ],
        },
      ],
    });
    expect(() => sanitizeTemplateDoc(nested)).toThrow(EditorDocError);
  });

  it("refuses what a note refuses: a document that is not a document, or one that is too large", () => {
    expect(() => sanitizeTemplateDoc({ type: "nope" })).toThrow(EditorDocError);
    const huge = doc(para(text("x".repeat(600_000))));
    expect(() => sanitizeTemplateDoc(huge)).toThrow(EditorDocError);
  });

  it("says whether a stored document is still usable", () => {
    expect(isUsableTemplateDoc(doc(para(text("fine"))))).toBe(true);
    expect(isUsableTemplateDoc({ nonsense: true })).toBe(false);
  });
});

describe("applyPlaceholders", () => {
  it("fills in each placeholder", () => {
    const out = applyPlaceholders(
      doc(para(text("{{date}} / {{day}} / {{time}} / {{title}}"))),
      ctx,
    );
    expect(textsOf(out)).toEqual(["13 October 2026 / Tuesday / 14:05 / Standup"]);
  });

  it("fills in two of the same, and keeps the marks of the text it sits in", () => {
    const out = applyPlaceholders(doc(para(text("{{day}} and {{day}}", [{ type: "bold" }]))), ctx);
    expect(out.content![0]!.content![0]).toEqual({
      type: "text",
      text: "Tuesday and Tuesday",
      marks: [{ type: "bold" }],
    });
  });

  it("uses the entry's own day, not today", () => {
    const out = applyPlaceholders(doc(para(text("{{date}}"))), { ...ctx, day: "2026-01-02" });
    expect(textsOf(out)).toEqual(["2 January 2026"]);
  });

  it("shows the time in the person's own zone", () => {
    const utc = applyPlaceholders(doc(para(text("{{time}}"))), { ...ctx, timezone: "UTC" });
    expect(textsOf(utc)).toEqual(["08:35"]);
  });

  it("leaves unknown names, spaced braces, formulas and half-typed ones exactly as typed", () => {
    const raw = "{{name}} {{ date }} {{date+1}} {{date} {Date} {{DATE}}";
    expect(textsOf(applyPlaceholders(doc(para(text(raw))), ctx))).toEqual([raw]);
  });

  it("does not match a placeholder split across two text nodes by a mark", () => {
    const out = applyPlaceholders(doc(para(text("{{da"), text("te}}", [{ type: "bold" }]))), ctx);
    expect(textsOf(out)).toEqual(["{{da", "te}}"]);
  });

  it("puts the value in as plain text: braces, dollar signs and HTML stay text", () => {
    const tricky = applyPlaceholders(doc(para(text("{{title}}"))), {
      ...ctx,
      title: "<b>$&</b> {{date}} $1",
    });
    expect(textsOf(tricky)).toEqual(["<b>$&</b> {{date}} $1"]);
  });

  it("drops a text node that comes out empty, so the document stays valid", () => {
    const out = applyPlaceholders(doc(para(text("{{title}}"))), { ...ctx, title: "" });
    expect(out.content![0]!.content).toEqual([]);
  });

  it("changes only text, never other attributes, and does not touch the original", () => {
    const original = doc({ type: "heading", attrs: { level: 2 }, content: [text("{{day}}")] });
    const before = JSON.stringify(original);
    const out = applyPlaceholders(original, ctx);
    expect(out.content![0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    expect(JSON.stringify(original)).toBe(before);
  });

  it("returns a malformed document unchanged and never throws", () => {
    const bad = {
      type: "doc",
      content: [{ type: "paragraph", content: "oops" }],
    } as unknown as TiptapDoc;
    expect(() => applyPlaceholders(bad, ctx)).not.toThrow();
    expect(applyPlaceholders({ type: "doc" }, ctx)).toEqual({ type: "doc", content: [] });
  });

  it("works across the midnight and start-of-day edge because the caller passes the day", () => {
    const late = applyPlaceholders(doc(para(text("{{date}}"))), {
      ...ctx,
      day: "2026-10-12",
      now: new Date("2026-10-13T00:30:00.000Z"),
      timezone: "UTC",
    });
    expect(textsOf(late)).toEqual(["12 October 2026"]);
  });
});

describe("applyToTitle", () => {
  it("fills in several placeholders", () => {
    expect(applyToTitle("Meeting: {{date}} ({{day}}) {{title}}", ctx)).toBe(
      "Meeting: 13 October 2026 (Tuesday) Standup",
    );
  });

  it("cuts an over-long result to 300 characters", () => {
    expect(applyToTitle("x".repeat(295) + "{{date}}", ctx).length).toBe(300);
  });

  it("is empty for an empty pattern, and keeps an unknown placeholder", () => {
    expect(applyToTitle("", ctx)).toBe("");
    expect(applyToTitle("{{nope}}", ctx)).toBe("{{nope}}");
  });
});

describe("starters", () => {
  it("are the four the spec names, each with a unique key", () => {
    expect(STARTER_KEYS).toEqual([
      "meeting-notes",
      "project-brief",
      "weekly-plan",
      "daily-journal",
    ]);
    expect(new Set(starterList().map((s) => s.name)).size).toBe(4);
  });

  it("each passes the template checks and holds no forbidden block", () => {
    for (const starter of starterList()) {
      expect(() => sanitizeTemplateDoc(starter.content), starter.key).not.toThrow();
      expect(JSON.stringify(starter.content)).not.toMatch(/"(image|file|subNote)"/);
      expect(starter.name.length).toBeLessThanOrEqual(120);
      expect(starter.titlePattern.length).toBeLessThanOrEqual(300);
    }
  });

  it("have the sections the spec lists", () => {
    const headings = (key: keyof typeof STARTERS) =>
      STARTERS[key].content
        .content!.filter((n) => n.type === "heading")
        .map((n) => n.content![0]!.text);
    expect(headings("meeting-notes")).toEqual(["Attendees", "Notes", "Decisions", "Action items"]);
    expect(headings("project-brief")).toEqual(["Goal", "Scope", "Risks", "Next steps"]);
    expect(headings("weekly-plan")).toEqual(["Top three", "Blocked by", "Wins"]);
    expect(headings("daily-journal")).toEqual(["Morning intention", "Notes", "End of day"]);
    expect(STARTERS["meeting-notes"].titlePattern).toBe("Meeting: {{date}}");
    expect(STARTERS["weekly-plan"].titlePattern).toBe("Week of {{date}}");
  });
});
