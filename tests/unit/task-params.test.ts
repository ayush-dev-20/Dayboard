import { describe, expect, it } from "vitest";
import {
  buildTasksQuery,
  describeStatuses,
  hasActiveFilters,
  parseTasksParams,
} from "@/lib/tasks/params";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("parseTasksParams", () => {
  it("uses the defaults for an empty URL", () => {
    expect(parseTasksParams({})).toEqual({
      view: "tasks",
      statuses: ["INBOX", "PLANNED", "IN_PROGRESS", "WAITING"],
      due: "any",
      archived: false,
      taskId: null,
    });
  });

  it("reads each choice", () => {
    const params = parseTasksParams({
      view: "todos",
      status: "done,cancelled",
      due: "overdue",
      archived: "1",
      task: ID,
    });
    expect(params).toMatchObject({
      view: "todos",
      statuses: ["DONE", "CANCELLED"],
      due: "overdue",
      archived: true,
      taskId: ID,
    });
  });

  it("ignores anything it doesn't recognise instead of failing", () => {
    const params = parseTasksParams({
      view: "nonsense",
      status: "bogus,,",
      due: "never",
      archived: "yes",
      task: "not-an-id",
    });
    expect(params.view).toBe("tasks");
    expect(params.statuses).toHaveLength(4);
    expect(params.due).toBe("any");
    expect(params.archived).toBe(false);
    expect(params.taskId).toBeNull();
  });

  it("keeps the valid statuses from a mixed list, once each, in any letter case", () => {
    expect(parseTasksParams({ status: "Done, bogus ,DONE,waiting" }).statuses).toEqual([
      "DONE",
      "WAITING",
    ]);
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseTasksParams({ due: ["today", "overdue"] }).due).toBe("today");
  });
});

describe("buildTasksQuery", () => {
  it("is empty at the defaults", () => {
    expect(buildTasksQuery({})).toBe("");
    expect(buildTasksQuery(parseTasksParams({}))).toBe("");
  });

  it("round-trips through parseTasksParams", () => {
    const original = parseTasksParams({
      view: "todos",
      status: "done",
      due: "none",
      archived: "1",
      task: ID,
    });
    const query = buildTasksQuery(original);
    const again = parseTasksParams(Object.fromEntries(new URLSearchParams(query)));
    expect(again).toEqual(original);
  });

  it("leaves out default values", () => {
    expect(buildTasksQuery({ due: "any", archived: false, taskId: null })).toBe("");
    expect(buildTasksQuery({ due: "today" })).toBe("?due=today");
  });
});

describe("hasActiveFilters and describeStatuses", () => {
  it("is false only at the defaults", () => {
    expect(hasActiveFilters(parseTasksParams({}))).toBe(false);
    expect(hasActiveFilters(parseTasksParams({ due: "today" }))).toBe(true);
    expect(hasActiveFilters(parseTasksParams({ status: "done" }))).toBe(true);
    expect(hasActiveFilters(parseTasksParams({ archived: "1" }))).toBe(true);
  });

  it("describes the status choice briefly", () => {
    expect(describeStatuses(parseTasksParams({}).statuses)).toBe("Open");
    expect(describeStatuses(["IN_PROGRESS"])).toBe("In progress");
    expect(describeStatuses(["DONE", "CANCELLED"])).toBe("2 selected");
  });
});
