import { describe, expect, it } from "vitest";
import { markdownToDoc } from "@/lib/editor/markdown";

// "Insert below" in Ask AI puts the answer in the note as real blocks, not as symbols: the answer's Markdown goes
// through the same converter as Generate and paste, so it can only hold what the editor can.

describe("Ask AI answer as editor blocks", () => {
  const doc = markdownToDoc(
    "### Some ideas\n\nHere are **three** steps:\n\n1. Start small.\n2. Add one piece.\n3. Test it.",
    { final: true },
  );

  it("becomes a heading, a paragraph with bold, and an ordered list", () => {
    const types = (doc.content ?? []).map((n) => n.type);
    expect(types).toEqual(["heading", "paragraph", "orderedList"]);
    const paragraph = doc.content![1]!;
    expect(paragraph.content?.some((n) => n.marks?.some((m) => m.type === "bold"))).toBe(true);
    expect(doc.content![2]!.content).toHaveLength(3);
  });

  it("leaves no Markdown symbols in the text", () => {
    expect(JSON.stringify(doc)).not.toMatch(/###|\*\*/);
  });

  it("keeps a plain answer as one paragraph, the same text as before", () => {
    const plain = markdownToDoc("The text says: “The owner is Priya.”", { final: true });
    expect(plain.content).toHaveLength(1);
    expect(plain.content![0]!.type).toBe("paragraph");
    expect(plain.content![0]!.content?.[0]?.text).toBe("The text says: “The owner is Priya.”");
  });

  it("gives nothing for an empty answer, so the caller can fall back", () => {
    expect(markdownToDoc("   \n\n", { final: true }).content ?? []).toHaveLength(0);
  });
});
