import "server-only";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output, streamText } from "ai";
import type { z } from "zod";
import { env } from "@/lib/env";
import {
  ProviderError,
  type AIProvider,
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
  };
}
