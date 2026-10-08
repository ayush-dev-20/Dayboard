import type { EditorView } from "@tiptap/pm/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitToBudget } from "@/lib/editor/clipboard/paste";
import {
  clearPasteRules,
  getPasteRules,
  registerCorePasteRules,
  registerPasteRule,
  runPasteRules,
  type ParsedClipboard,
  type PasteContext,
  type PasteRule,
} from "@/lib/editor/clipboard/rules";
import { decodeInternal, encodeInternal, INTERNAL_MIME } from "@/lib/editor/clipboard/slice";
import { MAX_DOC_BYTES } from "@/lib/editor/schema";
import type { TiptapNode } from "@/lib/editor/types";

const t = (
  text: string,
  marks?: { type: string; attrs?: Record<string, unknown> }[],
): TiptapNode => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const p = (...c: TiptapNode[]): TiptapNode => ({ type: "paragraph", content: c });

describe("the Dayboard flavour", () => {
  it("names its type", () => {
    expect(INTERNAL_MIME).toBe("application/x-dayboard-slice+json");
  });

  it("reads back what was written, open ends included", () => {
    const content = [p(t("one", [{ type: "bold" }])), { type: "bulletList", content: [] }];
    const slice = decodeInternal(encodeInternal(content, 1, 3));
    expect(slice).toEqual({ v: 1, doc: { type: "doc", content }, openStart: 1, openEnd: 3 });
  });

  it("keeps every new block and its attributes", () => {
    const content: TiptapNode[] = [
      { type: "callout", attrs: { emoji: "⚠️", tone: "warning" }, content: [p(t("careful"))] },
      {
        type: "toggle",
        attrs: { id: "abc123" },
        content: [
          { type: "toggleSummary", attrs: { level: 2 }, content: [t("Title")] },
          { type: "toggleContent", content: [p(t("body"))] },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [{ type: "tableHeader", attrs: { colwidth: [120] }, content: [p(t("h"))] }],
          },
        ],
      },
      { type: "tableOfContents" },
      {
        type: "taskList",
        content: [{ type: "taskItem", attrs: { checked: true }, content: [p(t("x"))] }],
      },
      { type: "codeBlock", attrs: { language: "ts" }, content: [t("x")] },
    ];
    expect(decodeInternal(encodeInternal(content, 0, 0))?.doc.content).toEqual(content);
  });

  it.each([
    ["nothing", undefined],
    ["an empty string", ""],
    ["text that is not JSON", "{nope"],
    ["JSON that is not a slice", '"hello"'],
    [
      "a version it does not know",
      JSON.stringify({
        v: 2,
        doc: { type: "doc", content: [p(t("x"))] },
        openStart: 0,
        openEnd: 0,
      }),
    ],
    [
      "no version",
      JSON.stringify({ doc: { type: "doc", content: [p(t("x"))] }, openStart: 0, openEnd: 0 }),
    ],
    [
      "open ends that are not numbers",
      JSON.stringify({
        v: 1,
        doc: { type: "doc", content: [p(t("x"))] },
        openStart: "a",
        openEnd: 0,
      }),
    ],
    [
      "an empty document",
      JSON.stringify({ v: 1, doc: { type: "doc", content: [] }, openStart: 0, openEnd: 0 }),
    ],
  ])("ignores %s", (_name, raw) => {
    expect(decodeInternal(raw)).toBeNull();
  });

  it.each([
    ["a javascript: link", p(t("x", [{ type: "link", attrs: { href: "javascript:alert(1)" } }]))],
    ["an unknown node", { type: "iframe", attrs: { src: "https://evil.example" } }],
    ["an unknown mark", p(t("x", [{ type: "highlight" }]))],
    ["a heading of level 9", { type: "heading", attrs: { level: 9 }, content: [t("x")] }],
    [
      "a callout with a bad emoji",
      { type: "callout", attrs: { emoji: "not an emoji", tone: "info" }, content: [p(t("x"))] },
    ],
    ["empty text", p({ type: "text", text: "" })],
  ])("refuses %s that a page put on the clipboard", (_name, node) => {
    const raw = JSON.stringify({
      v: 1,
      doc: { type: "doc", content: [node] },
      openStart: 0,
      openEnd: 0,
    });
    expect(decodeInternal(raw)).toBeNull();
  });

  it("drops attributes it does not know", () => {
    const raw = JSON.stringify({
      v: 1,
      doc: {
        type: "doc",
        content: [{ type: "heading", attrs: { level: 2, onclick: "x()" }, content: [t("h")] }],
      },
      openStart: 0,
      openEnd: 0,
    });
    expect(decodeInternal(raw)?.doc.content[0]).toEqual({
      type: "heading",
      attrs: { level: 2 },
      content: [t("h")],
    });
  });

  it("refuses an oversized flavour and absurd nesting", () => {
    expect(decodeInternal("x".repeat(2_000_001))).toBeNull();
    let node: TiptapNode = p(t("x"));
    for (let i = 0; i < 60; i += 1) node = { type: "blockquote", content: [node] };
    expect(decodeInternal(encodeInternal([node], 0, 0))).toBeNull();
  });
});

describe("paste rule registry", () => {
  afterEach(() => clearPasteRules());

  const ctx: PasteContext = { surface: "note", ownerId: null, offline: false };
  const data = (text: string, internal = false): ParsedClipboard => ({
    types: ["text/plain"],
    html: "",
    text,
    files: [],
    internal: internal ? decodeInternal(encodeInternal([p(t("x"))], 0, 0)) : null,
  });
  const rule = (id: string, priority: number, handles: boolean, test = true): PasteRule => ({
    id,
    priority,
    test: () => test,
    apply: vi.fn(() => handles),
  });

  it("runs rules lowest priority first and stops at the first that handles the paste", () => {
    const order: string[] = [];
    const make = (id: string, priority: number, handles: boolean): PasteRule => ({
      id,
      priority,
      test: () => true,
      apply: () => (order.push(id), handles),
    });
    registerPasteRule(make("late", 50, true));
    registerPasteRule(make("first", 1, false));
    registerPasteRule(make("middle", 10, true));
    expect(getPasteRules().map((r) => r.id)).toEqual(["first", "middle", "late"]);
    expect(runPasteRules({} as EditorView, data("x"), ctx)).toBe(true);
    expect(order).toEqual(["first", "middle"]);
  });

  it("skips a rule whose test says no, and reports an unhandled paste", () => {
    const skipped = rule("skipped", 1, true, false);
    registerPasteRule(skipped);
    registerPasteRule(rule("declines", 2, false));
    expect(runPasteRules({} as EditorView, data("x"), ctx)).toBe(false);
    expect(skipped.apply).not.toHaveBeenCalled();
  });

  it("refuses two rules with the same id", () => {
    registerPasteRule(rule("a", 1, false));
    expect(() => registerPasteRule(rule("a", 2, false))).toThrow(/already registered/);
  });

  it("lets a later feature add a rule without touching the paste code", () => {
    registerCorePasteRules();
    registerCorePasteRules();
    const before = getPasteRules().length;
    registerPasteRule(rule("image-upload", 20, false));
    // A later feature's rule (lower number) runs before the URL rule.
    expect(getPasteRules().map((r) => r.id)).toEqual([
      "image-upload",
      "note-address",
      "url-over-selection",
    ]);
    expect(getPasteRules()).toHaveLength(before + 1);
  });

  it("ships the note-address rule and the URL-over-selection rule", () => {
    registerCorePasteRules();
    expect(getPasteRules().map((r) => r.id)).toEqual(["note-address", "url-over-selection"]);
  });

  it("the URL rule claims a lone address, not text around one, not Dayboard's own paste", () => {
    registerCorePasteRules();
    const url = getPasteRules().find((r) => r.id === "url-over-selection");
    expect(url!.test(data("https://example.com/a?b=1"), ctx)).toBe(true);
    expect(url!.test(data("  https://example.com  "), ctx)).toBe(true);
    expect(url!.test(data("see https://example.com"), ctx)).toBe(false);
    expect(url!.test(data("two https://a.test https://b.test"), ctx)).toBe(false);
    expect(url!.test(data("javascript:alert(1)"), ctx)).toBe(false);
    expect(url!.test(data("ftp://example.com"), ctx)).toBe(false);
    expect(url!.test(data("https://example.com", true), ctx)).toBe(false);
  });
});

describe("the size limit", () => {
  const block = (size: number): TiptapNode => p(t("x".repeat(size)));

  it("keeps everything that fits", () => {
    const blocks = [block(1000), block(1000)];
    expect(fitToBudget(blocks, 0)).toEqual({ blocks, shortened: false });
  });

  it("cuts at a block boundary when the document would pass its limit", () => {
    const blocks = [block(60_000), block(60_000), block(60_000), block(60_000)];
    const result = fitToBudget(blocks, 50_000);
    expect(result.shortened).toBe(true);
    expect(result.blocks).toEqual(blocks.slice(0, 2));
    expect(JSON.stringify(result.blocks).length + 50_000).toBeLessThan(MAX_DOC_BYTES);
  });

  it("cuts inside a single text block that is larger than everything that is left", () => {
    const result = fitToBudget([block(500_000)], 0);
    expect(result.shortened).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(JSON.stringify(result.blocks).length).toBeLessThan(MAX_DOC_BYTES);
    expect(result.blocks[0]?.content?.[0]?.text?.length).toBeGreaterThan(100_000);
  });

  it("keeps nothing when the first block is not text and does not fit", () => {
    const table: TiptapNode = {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [block(300_000)] }] }],
    };
    expect(fitToBudget([table], 0)).toEqual({ blocks: [], shortened: true });
  });
});
