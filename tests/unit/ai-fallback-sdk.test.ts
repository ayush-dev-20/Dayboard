import { simulateReadableStream } from "ai";
import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { z } from "zod";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantTurnEvent, CallOptions } from "@/lib/ai/provider";

// The real provider code on the SDK's own mock models: no network and no key. Each model name gets a
// scripted model, so the order the provider tries them in can be read from which ones were called.

const registry = vi.hoisted(() => ({
  models: {} as Record<string, unknown>,
  env: {} as Record<string, unknown>,
}));

vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (name: string) => registry.models[name],
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: () => () => undefined }));
vi.mock("@/lib/env", () => ({ env: registry.env }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const usage = {
  inputTokens: { total: 5, noCache: 5, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
const quota = () =>
  new APICallError({ message: "quota", url: "https://x", requestBodyValues: {}, statusCode: 429 });
const denied = () =>
  new APICallError({ message: "key", url: "https://x", requestBodyValues: {}, statusCode: 401 });

const okGenerate = (json: unknown) => async () => ({
  content: [{ type: "text" as const, text: JSON.stringify(json) }],
  finishReason: { unified: "stop" as const, raw: "stop" },
  usage,
  warnings: [],
});
const okStream =
  (...words: string[]) =>
  async () => ({
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "text-start" as const, id: "t" },
        ...words.map((delta) => ({ type: "text-delta" as const, id: "t", delta })),
        { type: "text-end" as const, id: "t" },
        { type: "finish" as const, finishReason: { unified: "stop" as const, raw: "stop" }, usage },
      ],
    }),
  });
const failStream = (error: () => Error) => async () => {
  throw error();
};

const options = (tier: "main" | "fast" = "main"): CallOptions => ({
  feature: "DAILY",
  tier,
  system: "s",
  prompt: "p",
  signal: new AbortController().signal,
});

async function provider() {
  vi.resetModules();
  const mod = await import("@/lib/ai/providers/sdk");
  return mod.createSdkProvider();
}

beforeEach(() => {
  registry.models = {};
  // The same object for the whole file: the mocked env module keeps the first one it saw.
  for (const key of Object.keys(registry.env)) delete registry.env[key];
  Object.assign(registry.env, { aiProvider: "gemini", AI_API_KEY: "k", aiFallbackModels: null });
});

describe("structured answers", () => {
  it("answers from the next model when 3.5 Flash is out of quota, and says which one answered", async () => {
    const first = new MockLanguageModelV4({
      doGenerate: async () => {
        throw quota();
      },
    });
    const second = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    registry.models = { "gemini-3.5-flash": first, "gemini-3.5-flash-lite": second };
    const result = await (
      await provider()
    ).generateStructured(options(), z.object({ ok: z.boolean() }));
    expect(result.output).toEqual({ ok: true });
    expect(result.model).toBe("gemini-3.5-flash-lite");
    expect(first.doGenerateCalls).toHaveLength(1);
    expect(second.doGenerateCalls).toHaveLength(1);
  });

  it("reaches the 2.5 models when both 3.5 models are down", async () => {
    const down = () =>
      new MockLanguageModelV4({
        doGenerate: async () => {
          throw quota();
        },
      });
    const last = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    registry.models = {
      "gemini-3.5-flash": down(),
      "gemini-3.5-flash-lite": down(),
      "gemini-2.5-flash": down(),
      "gemini-2.5-flash-lite": last,
    };
    const result = await (
      await provider()
    ).generateStructured(options(), z.object({ ok: z.boolean() }));
    expect(result.model).toBe("gemini-2.5-flash-lite");
  });

  it("does not try another model when the key is refused", async () => {
    const first = new MockLanguageModelV4({
      doGenerate: async () => {
        throw denied();
      },
    });
    const second = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    registry.models = { "gemini-3.5-flash": first, "gemini-3.5-flash-lite": second };
    await expect(
      (await provider()).generateStructured(options(), z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ name: "ProviderError", retryable: false });
    expect(second.doGenerateCalls).toHaveLength(0);
  });

  it("starts the next call with the model that worked, not the one that just failed", async () => {
    const first = new MockLanguageModelV4({
      doGenerate: async () => {
        throw quota();
      },
    });
    const second = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    registry.models = { "gemini-3.5-flash": first, "gemini-3.5-flash-lite": second };
    const p = await provider();
    await p.generateStructured(options(), z.object({ ok: z.boolean() }));
    await p.generateStructured(options(), z.object({ ok: z.boolean() }));
    expect(first.doGenerateCalls).toHaveLength(1);
    expect(second.doGenerateCalls).toHaveLength(2);
  });

  it("uses only the list in AI_FALLBACK_MODELS when it is set, and none when it says none", async () => {
    registry.env.aiFallbackModels = ["gemini-2.5-flash"];
    const first = new MockLanguageModelV4({
      doGenerate: async () => {
        throw quota();
      },
    });
    const skipped = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    const chosen = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    registry.models = {
      "gemini-3.5-flash": first,
      "gemini-3.5-flash-lite": skipped,
      "gemini-2.5-flash": chosen,
    };
    const result = await (
      await provider()
    ).generateStructured(options(), z.object({ ok: z.boolean() }));
    expect(result.model).toBe("gemini-2.5-flash");
    expect(skipped.doGenerateCalls).toHaveLength(0);

    registry.env.aiFallbackModels = [];
    registry.models = {
      "gemini-3.5-flash": new MockLanguageModelV4({
        doGenerate: async () => {
          throw quota();
        },
      }),
      "gemini-3.5-flash-lite": skipped,
    };
    await expect(
      (await provider()).generateStructured(options(), z.object({ ok: z.boolean() })),
    ).rejects.toBeDefined();
    expect(skipped.doGenerateCalls).toHaveLength(0);
  });

  it("the fast tier starts at Flash-Lite and falls back to 2.5 Flash-Lite", async () => {
    const lite35 = new MockLanguageModelV4({
      doGenerate: async () => {
        throw quota();
      },
    });
    const lite25 = new MockLanguageModelV4({ doGenerate: okGenerate({ ok: true }) });
    registry.models = { "gemini-3.5-flash-lite": lite35, "gemini-2.5-flash-lite": lite25 };
    const result = await (
      await provider()
    ).generateStructured(options("fast"), z.object({ ok: z.boolean() }));
    expect(result.model).toBe("gemini-2.5-flash-lite");
  });
});

describe("streamed answers", () => {
  const read = async (stream: { chunks: AsyncIterable<string> }) => {
    let text = "";
    for await (const chunk of stream.chunks) text += chunk;
    return text;
  };

  it("moves on when the model cannot start, and the person sees one clean answer", async () => {
    const first = new MockLanguageModelV4({ doStream: failStream(quota) });
    const second = new MockLanguageModelV4({ doStream: okStream("Hello ", "there") });
    registry.models = { "gemini-3.5-flash": first, "gemini-3.5-flash-lite": second };
    const stream = (await provider()).streamText(options());
    expect(await read(stream)).toBe("Hello there");
    expect(stream.modelUsed?.()).toBe("gemini-3.5-flash-lite");
  });

  it("does not switch models once text has reached the person", async () => {
    const broken = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [
            { type: "stream-start" as const, warnings: [] },
            { type: "text-start" as const, id: "t" },
            { type: "text-delta" as const, id: "t", delta: "Half an ans" },
            { type: "error" as const, error: quota() },
          ],
        }),
      }),
    });
    const second = new MockLanguageModelV4({ doStream: okStream("Another answer") });
    registry.models = { "gemini-3.5-flash": broken, "gemini-3.5-flash-lite": second };
    const stream = (await provider()).streamText(options());
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const chunk of stream.chunks) seen.push(chunk);
      })(),
    ).rejects.toMatchObject({ name: "ProviderError" });
    expect(seen.join("")).toBe("Half an ans");
    expect(second.doStreamCalls).toHaveLength(0);
  });
});

describe("the assistant turn", () => {
  const events = async (turn: { events: AsyncIterable<AssistantTurnEvent> }) => {
    const out: AssistantTurnEvent[] = [];
    for await (const event of turn.events) out.push(event);
    return out;
  };
  const run = async () =>
    (await provider()).runAssistantTurn({
      system: "s",
      messages: [{ role: "user", text: "hi" }],
      tools: {},
      maxSteps: 3,
      signal: new AbortController().signal,
    });

  it("falls back before anything was said, and reports the model that answered", async () => {
    const first = new MockLanguageModelV4({ doStream: failStream(quota) });
    const second = new MockLanguageModelV4({ doStream: okStream("Fine.") });
    registry.models = { "gemini-3.5-flash": first, "gemini-3.5-flash-lite": second };
    const turn = await run();
    expect(await events(turn)).toEqual([{ type: "text", delta: "Fine." }]);
    expect((await turn.usage).inputTokens).toBeGreaterThan(0);
    expect(turn.modelUsed?.()).toBe("gemini-3.5-flash-lite");
  });

  it("shows the failure when every model is out", async () => {
    const down = () => new MockLanguageModelV4({ doStream: failStream(quota) });
    registry.models = {
      "gemini-3.5-flash": down(),
      "gemini-3.5-flash-lite": down(),
      "gemini-2.5-flash": down(),
      "gemini-2.5-flash-lite": down(),
    };
    await expect(events(await run())).rejects.toMatchObject({ name: "ProviderError" });
  });
});
