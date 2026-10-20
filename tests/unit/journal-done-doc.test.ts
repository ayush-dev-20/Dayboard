import { describe, expect, it } from "vitest";
import { sanitizeDoc } from "@/lib/editor/schema";
import { doneDocument } from "@/lib/journal/done-doc";

const item = (title: string) => ({ title, parentTitle: null });

describe("doneDocument", () => {
  it("is a Done heading and a bullet list of the titles, in order", () => {
    const doc = doneDocument([item("Ship the release"), item("Call the plumber")])!;
    expect(doc.content![0]).toMatchObject({ type: "heading", attrs: { level: 2 } });
    const list = doc.content![1]!;
    expect(list.type).toBe("bulletList");
    expect(list.content!.map((li) => li.content![0]!.content![0]!.text)).toEqual([
      "Ship the release",
      "Call the plumber",
    ]);
  });

  it("adds nothing when nothing was done", () => {
    expect(doneDocument([])).toBeNull();
  });

  it("keeps special characters as text, never as markup", () => {
    const tricky = `Fix <b>bold</b> & "quotes" — 100% ✅ [link](http://x) \`code\``;
    const doc = doneDocument([item(tricky)])!;
    expect(doc.content![1]!.content![0]!.content![0]!.content![0]!.text).toBe(tricky);
  });

  it("tidies whitespace and gives an empty title a name", () => {
    const doc = doneDocument([item("  spaced \n out  "), item("   ")])!;
    const texts = doc.content![1]!.content!.map((li) => li.content![0]!.content![0]!.text);
    expect(texts).toEqual(["spaced out", "Untitled"]);
  });

  it("passes the checks a note's text must pass", () => {
    const doc = doneDocument([item("One"), item("Two")])!;
    expect(() => sanitizeDoc(doc, { allowSubNotes: false })).not.toThrow();
  });
});
