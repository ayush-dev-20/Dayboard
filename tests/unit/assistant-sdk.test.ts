import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { assistantTurnOn } from "@/lib/ai/providers/sdk";
import type { AssistantTools, AssistantTurnEvent } from "@/lib/ai/provider";

vi.mock("@/lib/env", () => ({ env: { aiProvider: "anthropic", AI_API_KEY: "test" } }));

// The tool-using turn on the real SDK code, with the SDK's own mock model (no network, no key): the
// model calls a tool, the tool's text goes back, the model answers; and the step cap switches tools
// off for the last step so there is always an answer.

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const finish = (reason: "stop" | "tool-calls") => ({
  type: "finish" as const,
  finishReason: { unified: reason, raw: reason },
  usage,
});
const toolCall = (name: string, input: unknown, id = "call-1") => ({
  type: "tool-call" as const,
  toolCallId: id,
  toolName: name,
  input: JSON.stringify(input),
});
const text = (value: string) => [
  { type: "text-start" as const, id: "t1" },
  { type: "text-delta" as const, id: "t1", delta: value },
  { type: "text-end" as const, id: "t1" },
];
const stream = (...chunks: unknown[]) =>
  ({
    stream: simulateReadableStream({
      chunks: [{ type: "stream-start", warnings: [] }, ...chunks],
    }),
  }) as never;

async function run(model: MockLanguageModelV4, tools: AssistantTools, maxSteps = 5) {
  const turn = assistantTurnOn(model, {
    system: "system",
    messages: [{ role: "user", text: "hello" }],
    tools,
    maxSteps,
    signal: new AbortController().signal,
  });
  const events: AssistantTurnEvent[] = [];
  for await (const event of turn.events) events.push(event);
  return { events, usage: await turn.usage };
}

describe("a tool-using turn on the SDK", () => {
  it("calls a tool with validated input, returns its text to the model, then streams the answer", async () => {
    const seen: unknown[] = [];
    const tools: AssistantTools = {
      lookup: {
        description: "Look something up",
        inputSchema: z.object({ query: z.string() }),
        execute: async (input) => {
          seen.push(input);
          return { text: "Found: S1" };
        },
      },
    };
    const model = new MockLanguageModelV4({
      doStream: [
        stream(toolCall("lookup", { query: "otp" }), finish("tool-calls")),
        stream(...text("It is in S1."), finish("stop")),
      ],
    });
    const { events, usage: tokens } = await run(model, tools);
    expect(seen).toEqual([{ query: "otp" }]);
    expect(events).toEqual([
      { type: "tool", name: "lookup", status: "start" },
      { type: "tool", name: "lookup", status: "done" },
      { type: "text", delta: "It is in S1." },
    ]);
    expect(tokens.inputTokens).toBeGreaterThan(0);
    // The tool's text went back to the model for the second step.
    expect(JSON.stringify(model.doStreamCalls[1]?.prompt)).toContain("Found: S1");
  });

  it("does not run a tool for arguments that fail the schema", async () => {
    let calls = 0;
    const tools: AssistantTools = {
      lookup: {
        description: "x",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => {
          calls += 1;
          return { text: "never" };
        },
      },
    };
    const model = new MockLanguageModelV4({
      doStream: [
        stream(toolCall("lookup", { query: 42 }), finish("tool-calls")),
        stream(...text("Sorry."), finish("stop")),
      ],
    });
    await run(model, tools);
    expect(calls).toBe(0);
  });

  it("turns tools off for the step after the cap, so there is always an answer", async () => {
    const tools: AssistantTools = {
      lookup: {
        description: "x",
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({ text: "more" }),
      },
    };
    const model = new MockLanguageModelV4({
      doStream: [
        stream(toolCall("lookup", { query: "a" }, "c1"), finish("tool-calls")),
        stream(toolCall("lookup", { query: "b" }, "c2"), finish("tool-calls")),
        stream(...text("Final."), finish("stop")),
      ],
    });
    const { events } = await run(model, tools, 2);
    expect(events.filter((e) => e.type === "tool" && e.status === "start")).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "text", delta: "Final." });
    expect(model.doStreamCalls).toHaveLength(3);
    // The last step is told it may not call a tool.
    expect(model.doStreamCalls[2]?.toolChoice).toEqual({ type: "none" });
    expect(model.doStreamCalls[0]?.toolChoice).not.toEqual({ type: "none" });
  });
});
