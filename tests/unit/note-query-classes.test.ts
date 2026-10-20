import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { NOTE_QUERY_CLASSES } from "@/lib/notes/query-classes";

// V3 feature 02 §3: every query that reads `notes` says whether it leaves journal entries out. This reads the query
// files, finds each exported function that touches the notes table and checks it against `NOTE_QUERY_CLASSES`.

const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "src/db/queries");
const FILES = [
  ...readdirSync(DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/db/queries/${f}`),
  "src/lib/review/load.ts",
  "src/lib/search/semantic/store.ts",
];

const READS_NOTES =
  /from\(notes\)|[jJ]oin\(notes|\bfrom notes\b|\bjoin notes\b|innerJoin\(notes|leftJoin\(notes/;
const LEAVES_ENTRIES_OUT = /plainNotes|journal_date is null/;

/** The exported functions of a file with their text, up to the next export. */
function exportedFunctions(file: string) {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  return source
    .split(/^(?=export )/m)
    .map((part) => ({ name: /^export (?:async )?function (\w+)/.exec(part)?.[1], text: part }))
    .filter((f): f is { name: string; text: string } => Boolean(f.name));
}

describe("note queries and journal entries", () => {
  const found = FILES.flatMap((file) =>
    exportedFunctions(file)
      .filter((f) => READS_NOTES.test(f.text))
      .map((f) => ({ key: `${file}:${f.name}`, file, ...f })),
  );

  it("finds the queries that read notes", () => {
    expect(found.length).toBeGreaterThan(20);
  });

  it("lists every function that reads notes, and nothing that no longer exists", () => {
    const missing = found.filter((f) => !(f.key in NOTE_QUERY_CLASSES)).map((f) => f.key);
    expect(missing, "add these to src/lib/notes/query-classes.ts").toEqual([]);

    const everyFunction = new Set(
      FILES.flatMap((f) => exportedFunctions(f).map((x) => `${f}:${x.name}`)),
    );
    const stale = Object.keys(NOTE_QUERY_CLASSES).filter((k) => !everyFunction.has(k));
    expect(stale, "these are listed but no longer exist").toEqual([]);
  });

  it("every query classed as plain leaves entries out", () => {
    const plainFound = found.filter((f) => NOTE_QUERY_CLASSES[f.key] === "plain");
    expect(plainFound.length).toBeGreaterThan(4);
    // `loadFactsInput` builds its queries in helpers of the same file, so that file is checked as a whole.
    const wholeFile = new Set(["src/lib/review/load.ts"]);
    for (const f of plainFound) {
      const text = wholeFile.has(f.file) ? readFileSync(path.join(ROOT, f.file), "utf8") : f.text;
      expect(LEAVES_ENTRIES_OUT.test(text), `${f.key} must use plainNotes`).toBe(true);
    }
  });

  it("the queries classed as including entries do not filter them out", () => {
    for (const f of found.filter((x) => NOTE_QUERY_CLASSES[x.key] === "includes")) {
      expect(LEAVES_ENTRIES_OUT.test(f.text), `${f.key} would hide journal entries`).toBe(false);
    }
  });
});
