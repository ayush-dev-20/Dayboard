import { describe, expect, it } from "vitest";
import { EMBED_DIMENSIONS } from "@/lib/ai/embedding";
import { cosine, mockVector } from "@/lib/ai/providers/mock-embed";
import type { TiptapDoc } from "@/lib/editor/types";
import {
  chunkNote,
  chunkPlain,
  estimateTokens,
  MAX_CHUNKS,
  MAX_DESCRIPTION_CHARS,
} from "@/lib/search/chunk";
import { aboveMinimum, boostOf, fuse, MIN_SIMILARITY, RRF_K } from "@/lib/search/merge";
import { parseSearchText } from "@/lib/search/parse";

// V2 feature 10, the pure pieces: reading the search box, cutting text into pieces, merging two rankings
// and the mock embedder. No database and no network.

const p = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const h = (text: string, level = 2) => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const doc = (...content: unknown[]) => ({ type: "doc", content }) as TiptapDoc;

describe("parseSearchText", () => {
  it("reads plain words", () => {
    expect(parseSearchText("login  problems")).toEqual({
      text: "login problems",
      phrases: [],
      onlyPhrases: false,
    });
  });

  it("reads a quoted phrase and the words around it", () => {
    expect(parseSearchText('fix "exact words here" soon')).toEqual({
      text: "fix soon",
      phrases: ["exact words here"],
      onlyPhrases: false,
    });
  });

  it("marks a box that holds only phrases", () => {
    const parsed = parseSearchText('"first one" "second one"');
    expect(parsed.phrases).toEqual(["first one", "second one"]);
    expect(parsed.text).toBe("");
    expect(parsed.onlyPhrases).toBe(true);
  });

  it("keeps the words of an unbalanced quote as plain text", () => {
    expect(parseSearchText('alpha "beta gamma')).toEqual({
      text: "alpha beta gamma",
      phrases: [],
      onlyPhrases: false,
    });
  });

  it("treats curly quotes as quotes and ignores empty phrases", () => {
    expect(parseSearchText('“hello world” "" tail').phrases).toEqual(["hello world"]);
  });

  it("uses at most three phrases", () => {
    expect(parseSearchText('"a" "b" "c" "d"').phrases).toEqual(["a", "b", "c"]);
  });

  it("collapses spaces inside a phrase", () => {
    expect(parseSearchText('"a   b"').phrases).toEqual(["a b"]);
  });
});

describe("chunkNote", () => {
  it("prefixes every piece with the title and the nearest heading", () => {
    const chunks = chunkNote(
      "Launch plan",
      doc(p("Intro line."), h("Risks"), p("The vendor may be late."), h("Budget"), p("Under ten.")),
    );
    expect(chunks.map((c) => c.text)).toEqual([
      "Launch plan\nIntro line.",
      "Launch plan > Risks\nThe vendor may be late.",
      "Launch plan > Budget\nUnder ten.",
    ]);
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
  });

  it("keeps a short note as one piece", () => {
    expect(chunkNote("T", doc(p("one"), p("two")))).toHaveLength(1);
  });

  it("splits a long section into pieces of about 450 tokens, none over the cap", () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) =>
      p(`Paragraph ${i}. ${"word ".repeat(120)}`),
    );
    const chunks = chunkNote("Long", doc(...paragraphs));
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2600);
  });

  it("opens the next piece with the end of the last one when that end is short", () => {
    const chunks = chunkNote("N", doc(p("a".repeat(1000)), p("tail marker"), p("b".repeat(1000))));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]!.text).toContain("tail marker");
  });

  it("cuts a single huge paragraph", () => {
    const chunks = chunkNote("Big", doc(p(`${"Sentence number one. ".repeat(500)}`)));
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(2600);
  });

  it("includes list, table, toggle and callout words", () => {
    const chunks = chunkNote(
      "Mixed",
      doc(
        {
          type: "bulletList",
          content: [{ type: "listItem", content: [p("apples")] }],
        },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [{ type: "tableCell", content: [p("cell-text")] }],
            },
          ],
        },
        { type: "callout", content: [p("callout-text")] },
        {
          type: "toggle",
          content: [
            { type: "toggleSummary", content: [{ type: "text", text: "toggle-summary" }] },
            { type: "toggleContent", content: [p("toggle-body")] },
          ],
        },
      ),
    );
    const all = chunks.map((c) => c.text).join("\n");
    for (const word of ["apples", "cell-text", "callout-text", "toggle-summary", "toggle-body"]) {
      expect(all).toContain(word);
    }
  });

  it("skips empty blocks, and gives a title-only note one piece", () => {
    expect(chunkNote("Only a title", doc(p(""), p("   ")))).toEqual([
      { index: 0, text: "Only a title", tokenEstimate: estimateTokens("Only a title") },
    ]);
  });

  it("gives nothing for a note with no title and no text", () => {
    expect(chunkNote("  ", doc(p("")))).toEqual([]);
    expect(chunkNote("", null)).toEqual([]);
  });

  it("never returns more than the cap", () => {
    const sections = Array.from({ length: MAX_CHUNKS + 20 }, (_, i) => [
      h(`H${i}`),
      p(`text ${i}`),
    ]).flat();
    expect(chunkNote("Many", doc(...sections))).toHaveLength(MAX_CHUNKS);
  });

  it("is deterministic", () => {
    const d = doc(h("A"), p("one"), p("two"));
    expect(chunkNote("T", d)).toEqual(chunkNote("T", d));
  });
});

describe("chunkPlain", () => {
  it("is the title and the description as one piece", () => {
    expect(chunkPlain("Pay rent", "Before Friday")).toEqual([
      {
        index: 0,
        text: "Pay rent\nBefore Friday",
        tokenEstimate: estimateTokens("Pay rent\nBefore Friday"),
      },
    ]);
  });

  it("works with no description, and with nothing at all", () => {
    expect(chunkPlain("Just a title", null)[0]!.text).toBe("Just a title");
    expect(chunkPlain("  ", "")).toEqual([]);
  });

  it("cuts a very long description", () => {
    const [chunk] = chunkPlain("T", "x".repeat(MAX_DESCRIPTION_CHARS * 2));
    expect(chunk!.text.length).toBeLessThanOrEqual(MAX_DESCRIPTION_CHARS + 2);
  });
});

describe("fuse", () => {
  it("scores by position in each list and marks the kind", () => {
    const result = fuse(["a", "b", "c"], ["c", "d"]);
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId.a!.kind).toBe("keyword");
    expect(byId.d!.kind).toBe("semantic");
    expect(byId.c!.kind).toBe("both");
    expect(byId.c!.score).toBeCloseTo(1 / (RRF_K + 3) + 1 / (RRF_K + 1), 10);
  });

  it("puts an item found by both ahead of one found by one", () => {
    expect(fuse(["x", "y"], ["y", "z"])[0]!.id).toBe("y");
  });

  it("is deterministic and breaks ties without depending on order of arrival", () => {
    const a = fuse(["k1", "k2"], ["s1", "s2"]);
    const b = fuse(["k1", "k2"], ["s1", "s2"]);
    expect(a).toEqual(b);
    // k1 and s1 tie on score and on best rank; the keyword position decides.
    expect(a[0]!.id).toBe("k1");
    expect(a[1]!.id).toBe("s1");
  });

  it("counts a repeated id once per list", () => {
    const r = fuse(["a", "a"], []);
    expect(r).toHaveLength(1);
    expect(r[0]!.score).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it("lets an exact phrase win outright, and a small boost only reorder neighbours", () => {
    const far = Array.from({ length: 30 }, (_, i) => `i${i}`);
    // A phrase match is a strong signal: it leads even from the bottom of the list.
    expect(fuse(far, [], new Map([["i29", boostOf({ phrase: true })]]))[0]!.id).toBe("i29");
    // An open task is a nudge: it beats its neighbour, not the whole list.
    expect(
      fuse(["first", "second"], [], new Map([["second", boostOf({ open: true })]]))[0]!.id,
    ).toBe("second");
    expect(fuse(far, [], new Map([["i29", boostOf({ open: true })]]))[0]!.id).toBe("i0");
  });
});

describe("boostOf and aboveMinimum", () => {
  it("rewards a phrase most and a newer item a little", () => {
    expect(boostOf({ phrase: true })).toBeGreaterThan(boostOf({ titleMatch: true }));
    expect(boostOf({ ageDays: 0 })).toBeGreaterThan(boostOf({ ageDays: 365 }));
    expect(boostOf({})).toBe(0);
  });

  it("drops meaning matches below the minimum", () => {
    const hits = [
      { id: "a", similarity: 0.9 },
      { id: "b", similarity: MIN_SIMILARITY },
      { id: "c", similarity: MIN_SIMILARITY - 0.01 },
    ];
    expect(aboveMinimum(hits).map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("mock embedder", () => {
  it("makes a unit vector of the right size, the same every time", () => {
    const v = mockVector("hello world");
    expect(v).toHaveLength(EMBED_DIMENSIONS);
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
    expect(mockVector("hello world")).toEqual(v);
  });

  it("gives a unit vector even for text with no words", () => {
    expect(Math.hypot(...mockVector("   ...  "))).toBeCloseTo(1, 6);
  });

  it("puts 'authentication problems' close to 'login failures with OTP'", () => {
    const query = mockVector("authentication problems");
    const note = mockVector("Login failures with OTP codes after the update");
    const unrelated = mockVector("Buy oranges and bake a birthday cake");
    expect(cosine(query, note)).toBeGreaterThan(MIN_SIMILARITY + 0.2);
    expect(cosine(query, unrelated)).toBeLessThan(MIN_SIMILARITY);
  });

  it("puts 'OTP security' close to a related task and far from a different one", () => {
    const query = mockVector("OTP security");
    expect(cosine(query, mockVector("Rotate the password reset token"))).toBeGreaterThan(
      MIN_SIMILARITY,
    );
    expect(cosine(query, mockVector("Plan the team lunch"))).toBeLessThan(MIN_SIMILARITY);
  });

  it("matches the same word in different forms", () => {
    expect(cosine(mockVector("budgets"), mockVector("budget"))).toBeGreaterThan(0.99);
  });
});
