// @vitest-environment jsdom
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "@/lib/editor/clipboard/parse-html";
import { planPaste } from "@/lib/editor/clipboard/paste";
import { sanitizeDoc } from "@/lib/editor/schema";
import type { TiptapDoc } from "@/lib/editor/types";

// V2 feature 02 §6: every fixture is what a tool puts on the clipboard, with the document the
// editor should make of it, written by hand. Add one with /dev/clipboard when a tool misbehaves.

type Fixture = {
  tool: string;
  captured: string;
  html: string;
  text: string;
  types: string[];
  extras?: Record<string, string>;
  expected: TiptapDoc;
};

const root = path.join(import.meta.dirname, "..", "fixtures", "clipboard");
const fixtures: { name: string; fixture: Fixture }[] = fs
  .readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .flatMap((tool) =>
    fs
      .readdirSync(path.join(root, tool))
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({
        name: `${tool}/${file.replace(/\.json$/, "")}`,
        fixture: JSON.parse(fs.readFileSync(path.join(root, tool, file), "utf8")) as Fixture,
      })),
  );

function modeOf(fixture: Fixture): string | undefined {
  const raw = fixture.extras?.["vscode-editor-data"];
  return raw ? (JSON.parse(raw) as { mode?: string }).mode : undefined;
}

const PRODUCER: Record<string, string> = {
  slack: "slack",
  notion: "notion",
  "google-docs": "google-docs",
  word: "word",
  gmail: "gmail",
  "apple-notes": "apple",
  github: "github",
  vscode: "vscode",
  "web-page": "generic",
};

describe("clipboard fixtures", () => {
  it("covers every tool the spec names", () => {
    const tools = new Set(fixtures.map((f) => f.fixture.tool));
    for (const tool of [
      "slack",
      "notion",
      "google-docs",
      "gmail",
      "apple-notes",
      "word",
      "web-page",
      "github",
      "vscode",
    ]) {
      expect(tools, tool).toContain(tool);
    }
  });

  it.each(fixtures)("$name pastes as the expected document", ({ fixture }) => {
    const plan = planPaste({
      types: fixture.types,
      html: fixture.html,
      text: fixture.text,
      files: [],
      internal: null,
      vscodeMode: modeOf(fixture),
    });
    expect(plan.kind).toBe("doc");
    if (plan.kind !== "doc") return;
    expect(plan.doc).toEqual(fixture.expected);
    // Whatever was pasted is a valid document.
    expect(sanitizeDoc(plan.doc)).toEqual(plan.doc);
  });

  it.each(fixtures.filter((f) => f.fixture.html))(
    "$name is recognised as its tool",
    ({ fixture }) => {
      expect(parseHtml(fixture.html, { vscodeMode: modeOf(fixture) })?.producer).toBe(
        PRODUCER[fixture.tool],
      );
    },
  );
});
