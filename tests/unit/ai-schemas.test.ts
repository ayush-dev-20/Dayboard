import { describe, expect, it } from "vitest";
import {
  classifyInboxSchema,
  dailySuggestionSchema,
  estimateSchema,
  extractTasksSchema,
  nextStepsSchema,
  overdueCleanupSchema,
  rewriteSchema,
  storedSuggestionSchema,
  subtasksSchema,
} from "@/lib/ai/schemas";
import {
  askRequestSchema,
  extractTasksRequestSchema,
  AI_TEXT_MAX,
  taskAssistRequestSchema,
} from "@/lib/validations/ai";

const id = "0192f2a0-7c1e-7000-8000-000000000001";

describe("extract tasks / action items output", () => {
  it("accepts valid items and optional fields", () => {
    const parsed = extractTasksSchema.parse({
      items: [
        {
          title: "Send agenda",
          dueDate: "friday",
          owner: "Meera",
          evidence: "Found in paragraph 2",
        },
        { title: "Book room" },
      ],
    });
    expect(parsed.items).toHaveLength(2);
  });

  it("rejects an empty title, an oversize title and more than 15 items", () => {
    expect(extractTasksSchema.safeParse({ items: [{ title: "  " }] }).success).toBe(false);
    expect(extractTasksSchema.safeParse({ items: [{ title: "x".repeat(201) }] }).success).toBe(
      false,
    );
    const sixteen = Array.from({ length: 16 }, (_, i) => ({ title: `Task ${i}` }));
    expect(extractTasksSchema.safeParse({ items: sixteen }).success).toBe(false);
    expect(extractTasksSchema.safeParse({ items: sixteen.slice(0, 15) }).success).toBe(true);
  });

  it("rejects evidence over 80 characters", () => {
    expect(
      extractTasksSchema.safeParse({ items: [{ title: "A", evidence: "e".repeat(81) }] }).success,
    ).toBe(false);
  });
});

describe("subtasks output", () => {
  const items = (n: number) => ({
    subtasks: Array.from({ length: n }, (_, i) => ({ title: `Step ${i}` })),
  });
  it("needs 3 to 8 items", () => {
    expect(subtasksSchema.safeParse(items(2)).success).toBe(false);
    expect(subtasksSchema.safeParse(items(3)).success).toBe(true);
    expect(subtasksSchema.safeParse(items(8)).success).toBe(true);
    expect(subtasksSchema.safeParse(items(9)).success).toBe(false);
  });
});

describe("overdue cleanup output", () => {
  it("accepts the four actions and rejects anything else", () => {
    for (const action of ["KEEP", "RESCHEDULE", "ARCHIVE", "CANCEL"]) {
      expect(
        overdueCleanupSchema.safeParse({ proposals: [{ taskId: id, action, reason: "Because" }] })
          .success,
      ).toBe(true);
    }
    expect(
      overdueCleanupSchema.safeParse({ proposals: [{ taskId: id, action: "DELETE", reason: "x" }] })
        .success,
    ).toBe(false);
  });
  it("needs a real task id and a reason of at most 100 characters", () => {
    expect(
      overdueCleanupSchema.safeParse({
        proposals: [{ taskId: "nope", action: "KEEP", reason: "x" }],
      }).success,
    ).toBe(false);
    expect(
      overdueCleanupSchema.safeParse({
        proposals: [{ taskId: id, action: "KEEP", reason: "x".repeat(101) }],
      }).success,
    ).toBe(false);
  });
});

describe("task assist output", () => {
  it("rewrite needs a description", () => {
    expect(rewriteSchema.safeParse({ description: "Better words" }).success).toBe(true);
    expect(rewriteSchema.safeParse({ title: "T" }).success).toBe(false);
  });
  it("estimate is one of the five buckets", () => {
    for (const estimate of ["≤15m", "≤1h", "half-day", "1 day", "multi-day"]) {
      expect(estimateSchema.safeParse({ estimate, rationale: "Because" }).success).toBe(true);
    }
    expect(estimateSchema.safeParse({ estimate: "2 hours", rationale: "x" }).success).toBe(false);
  });
  it("next steps need 1 to 5 steps", () => {
    expect(nextStepsSchema.safeParse({ steps: [] }).success).toBe(false);
    expect(nextStepsSchema.safeParse({ steps: ["a"] }).success).toBe(true);
    expect(nextStepsSchema.safeParse({ steps: ["a", "b", "c", "d", "e", "f"] }).success).toBe(
      false,
    );
  });
});

describe("classify and daily output", () => {
  it("classify takes the five types and three confidences", () => {
    expect(
      classifyInboxSchema.safeParse({ type: "TASK", title: "T", confidence: "low" }).success,
    ).toBe(true);
    expect(
      classifyInboxSchema.safeParse({ type: "EVENT", title: "T", confidence: "high" }).success,
    ).toBe(false);
  });
  it("a stored suggestion never keeps low confidence", () => {
    expect(
      storedSuggestionSchema.safeParse({ type: "TASK", title: "T", confidence: "low" }).success,
    ).toBe(false);
    expect(
      storedSuggestionSchema.safeParse({ type: "NOTE", title: "T", confidence: "medium" }).success,
    ).toBe(true);
  });
  it("the daily text is at most 280 characters", () => {
    expect(dailySuggestionSchema.safeParse({ text: "x".repeat(280) }).success).toBe(true);
    expect(dailySuggestionSchema.safeParse({ text: "x".repeat(281) }).success).toBe(false);
    expect(dailySuggestionSchema.safeParse({ text: "" }).success).toBe(false);
  });
});

describe("request schemas", () => {
  it("extract-tasks takes text or an inbox item, not both and not neither", () => {
    expect(extractTasksRequestSchema.safeParse({ text: "hello" }).success).toBe(true);
    expect(extractTasksRequestSchema.safeParse({ inboxItemId: id }).success).toBe(true);
    expect(extractTasksRequestSchema.safeParse({}).success).toBe(false);
    expect(extractTasksRequestSchema.safeParse({ text: "x", inboxItemId: id }).success).toBe(false);
  });
  it("input text is capped at 20,000 characters", () => {
    expect(extractTasksRequestSchema.safeParse({ text: "x".repeat(AI_TEXT_MAX) }).success).toBe(
      true,
    );
    expect(extractTasksRequestSchema.safeParse({ text: "x".repeat(AI_TEXT_MAX + 1) }).success).toBe(
      false,
    );
  });
  it("unknown keys, such as a client-sent user id, are rejected", () => {
    expect(
      taskAssistRequestSchema.safeParse({ taskId: id, mode: "ESTIMATE", userId: id }).success,
    ).toBe(false);
    expect(taskAssistRequestSchema.safeParse({ taskId: id, mode: "FLY" }).success).toBe(false);
  });
  it("a question needs a few characters", () => {
    expect(askRequestSchema.safeParse({ question: "a" }).success).toBe(false);
    expect(askRequestSchema.safeParse({ question: "What happened?" }).success).toBe(true);
  });
});
