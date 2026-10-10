import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnswerBody } from "@/components/ai/answer-body";
import { answerBlocks, parseInline, splitAnswer, type AnswerPart } from "@/lib/ai/answer";

const text = (t: string): AnswerPart => ({ kind: "text", text: t });

describe("parseInline", () => {
  it("turns **bold**, *italic* and `code` into runs", () => {
    expect(parseInline("A **Purpose** and *note* with `code` [1].")).toEqual([
      { kind: "text", text: "A " },
      { kind: "bold", text: "Purpose" },
      { kind: "text", text: " and " },
      { kind: "italic", text: "note" },
      { kind: "text", text: " with " },
      { kind: "code", text: "code" },
      { kind: "text", text: " [1]." },
    ]);
  });

  it("leaves lone or spaced asterisks as plain text", () => {
    expect(parseInline("2 * 3 * 4")).toEqual([{ kind: "text", text: "2 * 3 * 4" }]);
    expect(parseInline("a ** b")).toEqual([{ kind: "text", text: "a ** b" }]);
  });

  it("shows no symbols while a marker is half typed", () => {
    expect(parseInline("**Purpo", true)).toEqual([{ kind: "bold", text: "Purpo" }]);
    expect(parseInline("Tasks: **", true)).toEqual([{ kind: "text", text: "Tasks: " }]);
    expect(parseInline("run `npm", true)).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "npm" },
    ]);
  });

  it("does not guess when the answer is final", () => {
    expect(parseInline("**Purpo", false)).toEqual([{ kind: "text", text: "**Purpo" }]);
  });
});

describe("answerBlocks", () => {
  it("groups bullets, numbers and headings, and drops rules and bare markers", () => {
    const blocks = answerBlocks([
      text("## Summary"),
      text("Intro line."),
      text("* **Tasks**: one"),
      text("- second"),
      text("•  third"),
      text("---"),
      text("3. three"),
      text("4) four"),
      text("*"),
    ]);
    expect(blocks).toEqual([
      { kind: "h", text: "Summary" },
      { kind: "p", text: "Intro line." },
      { kind: "ul", items: ["**Tasks**: one", "second", "third"] },
      { kind: "ol", start: 3, items: ["three", "four"] },
    ]);
  });

  it("does not mistake **bold** at the start of a line for a bullet", () => {
    expect(answerBlocks([text("**Note**: all done")])).toEqual([
      { kind: "p", text: "**Note**: all done" },
    ]);
  });

  it("keeps a verified quote as its own block and ends the list around it", () => {
    const blocks = answerBlocks([
      text("- a"),
      { kind: "quote", text: "Budget is open" },
      text("- b"),
    ]);
    expect(blocks.map((b) => b.kind)).toEqual(["ul", "quote", "ul"]);
  });
});

describe("AnswerBody", () => {
  const html = (answer: string, streaming = false) =>
    renderToStaticMarkup(
      createElement(AnswerBody, { parts: splitAnswer(answer, [], [], true), streaming }),
    );

  it("renders the assistant's answer as formatted lists and bold, with no raw symbols", () => {
    const out = html(
      [
        "Here is the project.",
        "* **Purpose**: To keep track of the move [S1].",
        '* **Tasks**: It has one task, "Connect on phone", which was completed.',
      ].join("\n"),
    );
    expect(out).toContain("<ul");
    expect(out.match(/<li/g)).toHaveLength(2);
    expect(out).toContain("<strong");
    expect(out).not.toContain("**");
    expect(out).not.toContain("* ");
  });

  it("never turns answer text into markup", () => {
    const out = html("**<script>alert(1)</script>** <img src=x onerror=alert(1)>");
    expect(out).not.toContain("<script");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;script&gt;");
  });
});
