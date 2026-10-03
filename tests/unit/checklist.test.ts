import { describe, expect, it } from "vitest";
import { deriveChecklist } from "@/lib/onboarding/checklist";

describe("deriveChecklist", () => {
  it("starts with nothing done", () => {
    const c = deriveChecklist({ inbox: 0, tasks: 0, notes: 0, links: 0 });
    expect(c.done).toBe(0);
    expect(c.complete).toBe(false);
    expect(c.items.map((i) => i.key)).toEqual(["capture", "task", "note", "link"]);
  });
  it("ticks each item from real data", () => {
    const c = deriveChecklist({ inbox: 3, tasks: 1, notes: 0, links: 0 });
    expect(c.items.filter((i) => i.done).map((i) => i.key)).toEqual(["capture", "task"]);
    expect(c.done).toBe(2);
  });
  it("is complete when all four exist", () => {
    const c = deriveChecklist({ inbox: 1, tasks: 1, notes: 1, links: 1 });
    expect(c.complete).toBe(true);
    expect(c.done).toBe(4);
  });
  it("links each open item to where it is done", () => {
    const hrefs = deriveChecklist({ inbox: 0, tasks: 0, notes: 0, links: 0 }).items.map(
      (i) => i.href,
    );
    expect(hrefs).toEqual(["/inbox", "/tasks?focus=add", "/notes/new", "/tasks"]);
  });
});
