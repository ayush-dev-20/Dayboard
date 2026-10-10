import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, stepCountIs, streamText, tool, type LanguageModel } from "ai";
import type { z } from "zod";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
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
import {
  canFallBack,
  CooldownBook,
  DEFAULT_FALLBACKS,
  firstThatWorks,
  modelChain,
} from "./fallback";

// The only file that imports the Vercel AI SDK. Swapping the model vendor means changing this file.

// Defaults per vendor. Gemini defaults: 3.5 Flash for structured and streamed work,
// Flash-Lite (higher free limits) for the short jobs. When a model cannot answer, the call moves on
// to the next one in the tier's fallback list (`fallback.ts`; `AI_FALLBACK_MODELS` can replace it).
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

/** Which models just failed on this server, so the next calls start with one that works. */
const cooling = new CooldownBook();

const logFallback = (feature: string) => (from: string, to: string, error: unknown) =>
  logger.warn("ai model fallback", { feature, from, to, error });

/**
 * One assistant turn that moves to the next model when the first cannot start (quota, outage). It only
 * moves on before anything has been sent: once the person has seen text or a tool step, a restart
 * would repeat or contradict it, so a later failure is shown as the failure it is.
 */
export function assistantTurnWithFallback(
  candidates: { name: string; model: LanguageModel }[],
  options: AssistantTurnOptions,
  book: CooldownBook = cooling,
): AssistantTurn {
  let resolveUsage: (u: TokenUsage) => void = () => {};
  const usage = new Promise<TokenUsage>((resolve) => {
    resolveUsage = resolve;
  });
  let used: string | undefined = candidates[0]?.name;
  const byName = new Map(candidates.map((c) => [c.name, c.model]));

  async function* events(): AsyncGenerator<AssistantTurnEvent> {
    const order = book.order(candidates.map((c) => c.name));
    let lastError: unknown;
    for (let i = 0; i < order.length; i += 1) {
      const name = order[i]!;
      const turn = assistantTurnOn(byName.get(name)!, options);
      let sent = false;
      try {
        for await (const event of turn.events) {
          sent = true;
          yield event;
        }
        used = name;
        book.clear(name);
        resolveUsage(await turn.usage);
        return;
      } catch (error) {
        lastError = error;
        const next = order[i + 1];
        if (sent || next === undefined || options.signal.aborted || !canFallBack(error)) {
          resolveUsage({});
          throw error;
        }
        book.note(name, error);
        logFallback("ASSISTANT")(name, next, error);
      }
    }
    resolveUsage({});
    throw lastError;
  }
  return { events: events(), usage, modelUsed: () => used };
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
  /** The tier's own model first, then the models to try if it cannot answer. */
  const chainFor = (tier: ModelTier) =>
    modelChain(modelName(tier), env.aiFallbackModels ?? DEFAULT_FALLBACKS[vendor][tier]);

  return {
    id: vendor,
    modelName,

    async generateStructured(options: CallOptions, schema: z.ZodType): Promise<StructuredResult> {
      try {
        const { value, model } = await firstThatWorks(
          chainFor(options.tier),
          cooling,
          options.signal,
          (name) =>
            generateText({
              model: languageModel(name),
              system: options.system,
              prompt: options.prompt,
              output: Output.object({ schema }),
              abortSignal: options.signal,
              maxOutputTokens: options.maxOutputTokens,
              maxRetries: 0,
            }),
          logFallback(options.feature),
        );
        return { output: value.output, usage: usageOf(value.usage), model };
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
      const chain = chainFor(options.tier);
      let used: string | undefined = chain[0];

      // Moves to the next model only while nothing has been sent: once text has reached the person,
      // a different model would repeat or contradict it, so a later failure is reported as it is.
      async function* chunks() {
        const order = cooling.order(chain);
        let lastError: unknown;
        for (let i = 0; i < order.length; i += 1) {
          const name = order[i]!;
          const result = streamText({
            model: languageModel(name),
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
          let sent = false;
          try {
            for await (const part of result.fullStream) {
              if (part.type === "text-delta") {
                sent = true;
                yield part.text;
              }
              if (part.type === "error") throw part.error;
            }
            used = name;
            cooling.clear(name);
            return;
          } catch (error) {
            lastError = error;
            const next = order[i + 1];
            if (sent || next === undefined || options.signal.aborted || !canFallBack(error)) {
              resolveUsage({});
              throw new ProviderError("The AI service failed.", isRetryable(error), {
                cause: error,
              });
            }
            cooling.note(name, error);
            logFallback(options.feature)(name, next, error);
          }
        }
        resolveUsage({});
        throw new ProviderError("The AI service failed.", isRetryable(lastError), {
          cause: lastError,
        });
      }
      return { chunks: chunks(), usage, modelUsed: () => used };
    },

    runAssistantTurn(options) {
      return assistantTurnWithFallback(
        chainFor("main").map((name) => ({ name, model: languageModel(name) })),
        options,
      );
    },
  };
}
