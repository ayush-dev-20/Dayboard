import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, stepCountIs, streamText, tool, type LanguageModel } from "ai";
import type { z } from "zod";
import { env } from "@/lib/env";
import {
  ProviderError,
  type AIProvider,
  type AssistantTools,
  type AssistantTurn,
  type AssistantTurnEvent,
  type AssistantTurnOptions,
  type CallOptions,
  type StructuredResult,
  type TextStream,
} from "../provider";
import type { ModelTier, TokenUsage } from "../types";

// The only file that imports the Vercel AI SDK. Swapping the model vendor means changing this file.

// Defaults per vendor. Gemini defaults: 3.5 Flash for structured and streamed work,
// Flash-Lite (higher free limits) for the short jobs.
const DEFAULTS = {
  anthropic: { main: "claude-sonnet-5-5", fast: "claude-haiku-4-5-20251001" },
  gemini: { main: "gemini-3.5-flash", fast: "gemini-3.5-flash-lite" },
} as const;

function isRetryable(error: unknown): boolean {
  const e = error as { statusCode?: number; isRetryable?: boolean; name?: string } | null;
  if (!e) return false;
  if (e.name === "AbortError" || e.name === "TimeoutError") return true;
  if (typeof e.statusCode === "number") return e.statusCode >= 500 || e.statusCode === 429;
  return e.isRetryable === true;
}

function usageOf(usage: { inputTokens?: number; outputTokens?: number } | undefined): TokenUsage {
  return { inputTokens: usage?.inputTokens, outputTokens: usage?.outputTokens };
}

/** Our tools as the SDK's: the model's arguments are validated against the Zod schema first. */
function sdkTools(tools: AssistantTools) {
  return Object.fromEntries(
    Object.entries(tools).map(([name, t]) => [
      name,
      tool({
        description: t.description,
        inputSchema: t.inputSchema as never,
        execute: async (input: unknown) => (await t.execute(input)).text,
      } as never),
    ]),
  );
}

/**
 * One assistant turn on any language model (feature 11 §4): the model may call the tools, up to
 * `maxSteps` times, and then has to answer. Exported so a test can run it on the SDK's own mock model.
 */
export function assistantTurnOn(
  model: LanguageModel,
  options: AssistantTurnOptions,
): AssistantTurn {
  let resolveUsage: (u: TokenUsage) => void = () => {};
  const usage = new Promise<TokenUsage>((resolve) => {
    resolveUsage = resolve;
  });
  const result = streamText({
    model,
    system: options.system,
    messages: options.messages.map((m) => ({ role: m.role, content: m.text })),
    tools: sdkTools(options.tools),
    // `maxSteps` tool steps, then one more step in which tools are off, so there is always an answer.
    stopWhen: stepCountIs(options.maxSteps + 1),
    prepareStep: ({ stepNumber }: { stepNumber: number }) =>
      stepNumber >= options.maxSteps ? { toolChoice: "none" as const } : undefined,
    abortSignal: options.signal,
    maxOutputTokens: options.maxOutputTokens,
    maxRetries: 0,
    onError: () => {
      // Surfaces through the iterator below.
    },
    onFinish: (event: { totalUsage?: unknown; usage?: unknown }) =>
      resolveUsage(usageOf((event.totalUsage ?? event.usage) as never)),
  } as never);

  async function* events(): AsyncGenerator<AssistantTurnEvent> {
    try {
      for await (const part of (
        result as unknown as {
          fullStream: AsyncIterable<{
            type: string;
            text?: string;
            toolName?: string;
            error?: unknown;
          }>;
        }
      ).fullStream) {
        if (part.type === "text-delta" && part.text) yield { type: "text", delta: part.text };
        else if (part.type === "tool-call")
          yield { type: "tool", name: part.toolName ?? "", status: "start" };
        else if (part.type === "tool-result" || part.type === "tool-error") {
          yield { type: "tool", name: part.toolName ?? "", status: "done" };
        } else if (part.type === "error") throw part.error;
      }
    } catch (error) {
      resolveUsage({});
      throw new ProviderError("The AI service failed.", isRetryable(error), { cause: error });
    }
  }
  return { events: events(), usage };
}

export function createSdkProvider(): AIProvider {
  const vendor = env.aiProvider === "gemini" ? "gemini" : "anthropic";
  const settings = {
    apiKey: env.AI_API_KEY,
    ...(env.AI_BASE_URL ? { baseURL: env.AI_BASE_URL } : {}),
  };
  const anthropic = createAnthropic(settings);
  const google = createGoogleGenerativeAI(settings);
  const languageModel = (name: string) => (vendor === "gemini" ? google(name) : anthropic(name));

  const defaults = DEFAULTS[vendor];
  const modelName = (tier: ModelTier) =>
    tier === "fast" ? (env.AI_MODEL_FAST ?? defaults.fast) : (env.AI_MODEL ?? defaults.main);

  return {
    id: vendor,
    modelName,

    async generateStructured(options: CallOptions, schema: z.ZodType): Promise<StructuredResult> {
      try {
        const result = await generateText({
          model: languageModel(modelName(options.tier)),
          system: options.system,
          prompt: options.prompt,
          output: Output.object({ schema }),
          abortSignal: options.signal,
          maxOutputTokens: options.maxOutputTokens,
          maxRetries: 0,
        });
        return { output: result.output, usage: usageOf(result.usage) };
      } catch (error) {
        // An answer the SDK could not parse into the schema is "bad output", not an outage.
        const name = (error as { name?: string } | null)?.name ?? "";
        if (/NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(name)) throw error;
        throw new ProviderError("The AI service failed.", isRetryable(error), { cause: error });
      }
    },

    streamText(options: CallOptions): TextStream {
      let resolveUsage: (u: TokenUsage) => void = () => {};
      const usage = new Promise<TokenUsage>((resolve) => {
        resolveUsage = resolve;
      });
      const result = streamText({
        model: languageModel(modelName(options.tier)),
        system: options.system,
        prompt: options.prompt,
        abortSignal: options.signal,
        maxOutputTokens: options.maxOutputTokens,
        maxRetries: 0,
        onError: () => {
          // Surfaces through the iterator below.
        },
        onFinish: (event) => resolveUsage(usageOf(event.totalUsage ?? event.usage)),
      });

      async function* chunks() {
        try {
          for await (const part of result.fullStream) {
            if (part.type === "text-delta") yield part.text;
            if (part.type === "error") throw part.error;
          }
        } catch (error) {
          resolveUsage({});
          throw new ProviderError("The AI service failed.", isRetryable(error), { cause: error });
        }
      }
      return { chunks: chunks(), usage };
    },

    runAssistantTurn(options) {
      return assistantTurnOn(languageModel(modelName("main")), options);
    },
  };
}
