import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_CLASSES } from "@/modules/permissions/classes";

// V3 feature 04 §10: "a test fails if a query for those types ignores it". Every exported function that reads or writes
// projects, tasks, todos or notes must say whether it is still scoped to the person's own rows, goes through the access
// check, or stays personal on purpose. A new query without a choice fails here.

const ROOT = path.resolve(__dirname, "../..");
const TABLES = ["projects", "tasks", "todos", "notes"];
const TOUCHES = new RegExp(
  `\\b(from\\(|innerJoin\\(|leftJoin\\(|update\\(|insert\\(|delete\\()(${TABLES.join("|")})\\b|\\b(from|join|update|into) (${TABLES.join("|")})\\b`,
);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith(".ts") ? [full] : [];
  });
}

const files = [
  ...readdirSync(path.join(ROOT, "src/db/queries")).map((f) => `src/db/queries/${f}`),
  ...readdirSync(path.join(ROOT, "src/db/mutations")).map((f) => `src/db/mutations/${f}`),
  ...walk(path.join(ROOT, "src/lib")).map((f) => path.relative(ROOT, f)),
]
  .filter((f) => f.endsWith(".ts"))
  .sort();

function touching() {
  const found: string[] = [];
  for (const file of files) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    for (const part of source.split(/^(?=export )/m)) {
      const name = /^export (?:async )?function (\w+)/.exec(part)?.[1];
      if (name && TOUCHES.test(part)) found.push(`${file}:${name}`);
    }
  }
  return found;
}

describe("the access classes", () => {
  const found = touching();

  it("find the functions that touch the four tables", () => {
    expect(found.length).toBeGreaterThan(100);
  });

  it("list every function that touches projects, tasks, todos or notes, and nothing that no longer exists", () => {
    const missing = found.filter((key) => !(key in ACCESS_CLASSES));
    expect(missing, "add these to src/modules/permissions/classes.ts with a choice").toEqual([]);
    const stale = Object.keys(ACCESS_CLASSES).filter((key) => !found.includes(key));
    expect(stale, "these are listed but no longer touch the tables").toEqual([]);
  });

  it("use only the three classes", () => {
    for (const [key, value] of Object.entries(ACCESS_CLASSES)) {
      expect(["owner", "access", "owner-by-design"], key).toContain(value);
    }
  });

  it("an `access` function really goes through the permission module", () => {
    for (const [key, value] of Object.entries(ACCESS_CLASSES)) {
      if (value !== "access") continue;
      const [file, name] = key.split(":");
      const source = readFileSync(path.join(ROOT, file!), "utf8");
      const body =
        source
          .split(/^(?=export )/m)
          .find((p) => new RegExp(`^export (?:async )?function ${name}\\b`).test(p)) ?? "";
      expect(
        /requireAccess|resolveAccess|accessibleWhere|@\/modules\/permissions/.test(body + source),
        key,
      ).toBe(true);
    }
  });
});
