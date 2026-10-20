import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TASK_QUERY_CLASSES } from "@/lib/tasks/query-classes";

// V3 feature 01 §13.4: every query that reads `tasks` says whether it leaves sticky notes out. This reads the query
// files, finds each exported function that touches the tasks table and checks it against `TASK_QUERY_CLASSES`.

const ROOT = path.resolve(__dirname, "../..");
const DIR = path.join(ROOT, "src/db/queries");
const FILES = [
  ...readdirSync(DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => `src/db/queries/${f}`),
  "src/lib/review/load.ts",
  "src/lib/review/service.ts",
  "src/lib/search/semantic/store.ts",
  "src/lib/notifications/deliver.ts",
  "src/lib/notifications/reminders.ts",
  "src/lib/calendar/create-event.ts",
];

const READS_TASKS =
  /from\(tasks\)|[jJ]oin\(tasks|\bfrom tasks\b|\bjoin tasks\b|innerJoin\(tasks|leftJoin\(tasks|\bFROM tasks\b|\bJOIN tasks\b/;
const LEAVES_STICKIES_OUT = /plainTasks|kind = 'TASK'/;

/** The exported functions of a file with their text, up to the next export. */
function exportedFunctions(file: string) {
  const source = readFileSync(path.join(ROOT, file), "utf8");
  return source
    .split(/^(?=export )/m)
    .map((part) => ({ name: /^export (?:async )?function (\w+)/.exec(part)?.[1], text: part }))
    .filter((f): f is { name: string; text: string } => Boolean(f.name));
}

describe("task queries and sticky notes", () => {
  const found = FILES.flatMap((file) =>
    exportedFunctions(file)
      .filter((f) => READS_TASKS.test(f.text))
      .map((f) => ({ key: `${file}:${f.name}`, file, ...f })),
  );

  it("finds the queries that read tasks", () => {
    expect(found.length).toBeGreaterThan(30);
  });

  it("lists every function that reads tasks, and nothing that no longer exists", () => {
    const missing = found.filter((f) => !(f.key in TASK_QUERY_CLASSES)).map((f) => f.key);
    expect(missing, "add these to src/lib/tasks/query-classes.ts").toEqual([]);

    const everyFunction = new Set(
      FILES.flatMap((f) => exportedFunctions(f).map((x) => `${f}:${x.name}`)),
    );
    const stale = Object.keys(TASK_QUERY_CLASSES).filter((k) => !everyFunction.has(k));
    expect(stale, "these are listed but no longer exist").toEqual([]);
  });

  it("every query classed as plain leaves stickies out", () => {
    const plainFound = found.filter((f) => TASK_QUERY_CLASSES[f.key] === "plain");
    expect(plainFound.length).toBeGreaterThan(20);
    // `loadFactsInput` builds its queries in helpers of the same file, so that file is checked as a whole.
    const wholeFile = new Set(["src/lib/review/load.ts"]);
    for (const f of plainFound) {
      const text = wholeFile.has(f.file) ? readFileSync(path.join(ROOT, f.file), "utf8") : f.text;
      expect(LEAVES_STICKIES_OUT.test(text), `${f.key} must use plainTasks`).toBe(true);
    }
  });

  it("the queries classed as including stickies do not filter them out", () => {
    for (const f of found.filter((x) => TASK_QUERY_CLASSES[x.key] === "includes")) {
      expect(LEAVES_STICKIES_OUT.test(f.text), `${f.key} would hide sticky notes`).toBe(false);
    }
  });
});
