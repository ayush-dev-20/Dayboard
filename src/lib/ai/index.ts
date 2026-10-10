import "server-only";
import type { z } from "zod";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { PROMPT_VERSIONS, repairHint } from "./prompts";
import {
  ProviderError,
  type AIProvider,
  type AssistantTools,
  type AssistantTurnEvent,
} from "./provider";
import type { ChatTurnMessage } from "./assistant-types";
import { createMockProvider } from "./providers/mock";
import { createSdkProvider } from "./providers/sdk";
import { recordUsage } from "./usage";
import type { AIFeature, ModelTier, TokenUsage } from "./types";

// The AI service every route handler uses. It adds what a raw provider does not: timeouts, the one
// retry, Zod validation of every answer, and a usage record. Nothing here writes workspace data.

export const STRUCTURED_TIMEOUT_MS = 30_000;
export const STREAM_TIMEOUT_MS = 60_000;

let cached: AIProvider | undefined;

export function getProvider(): AIProvider {
  cached ??= env.aiProvider === "mock" ? createMockProvider() : createSdkProvider();
  return cached;
}

/** False when a real provider has no key: every AI surface then stays hidden. */
export function isAIAvailable(): boolean {
  return env.aiAvailable;
}

type CommonArgs = {
  userId: string;
  feature: AIFeature;
  tier?: ModelTier;
  system: string;
  prompt: string;
  /** Most tokens the model may write (a longer note needs a bigger cap). */
  maxOutputTokens?: number;
  /** Plain-data copy of the request, for the mock provider only. */
  fixture?: unknown;
};

const sum = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0) || undefined,
  outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0) || undefined,
});

function providerFailure(cause?: unknown) {
  return new AppError("AI_PROVIDER_ERROR", undefined, { cause });
}

/**
 * Asks for structured output and returns it validated. At most two attempts: a provider outage or
 * timeout gets one retry, and an answer that fails validation gets one retry with a repair hint.
 * Records one `ai_usage` row however it ends.
 */
export async function generateStructured<S extends z.ZodType>(
  args: CommonArgs & { schema: S },
): Promise<z.infer<S>> {
  const provider = getProvider();
  const tier = args.tier ?? "main";
  const started = Date.now();
  let tokens: TokenUsage = {};
  let prompt = args.prompt;
  let status: "PROVIDER_ERROR" | "VALIDATION_ERROR" = "PROVIDER_ERROR";
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const result = await provider.generateStructured(
        {
          feature: args.feature,
          tier,
          system: args.system,
          prompt,
          fixture: args.fixture,
          signal: AbortSignal.timeout(STRUCTURED_TIMEOUT_MS),
        },
        args.schema,
      );
      tokens = sum(tokens, result.usage);
      const parsed = args.schema.safeParse(result.output);
      if (parsed.success) {
        await recordUsage({
          userId: args.userId,
          feature: args.feature,
          provider: provider.id,
          model: provider.modelName(tier),
          promptVersion: PROMPT_VERSIONS[args.feature],
          status: "SUCCESS",
          latencyMs: Date.now() - started,
          tokens,
        });
        return parsed.data;
      }
      status = "VALIDATION_ERROR";
      lastError = parsed.error;
      prompt = args.prompt + repairHint(parsed.error.issues[0]?.message ?? "wrong shape");
    } catch (error) {
      lastError = error;
      if (error instanceof ProviderError) {
        status = "PROVIDER_ERROR";
        if (!error.retryable) break;
      } else {
        // The SDK could not read the model's answer into the schema: invalid output.
        status = "VALIDATION_ERROR";
        prompt = args.prompt + repairHint("it was not valid JSON for the required shape");
      }
    }
  }

  logger.warn("ai call failed", { feature: args.feature, status, error: lastError });
  await recordUsage({
    userId: args.userId,
    feature: args.feature,
    provider: provider.id,
    model: provider.modelName(tier),
    promptVersion: PROMPT_VERSIONS[args.feature],
    status,
    latencyMs: Date.now() - started,
    tokens,
  });
  throw providerFailure(lastError);
}

export type StreamSession = {
  chunks: AsyncIterable<string>;
  /**
   * Call once when the stream ended (ok) or broke (not ok). Records usage. A stream the person
   * stopped (the client went away) counts as a success: the provider worked and quota was used.
   */
  finish(ok: boolean): Promise<void>;
};

/** Opens a streamed answer. The caller reads `chunks`, then calls `finish`. */
export function streamText(args: CommonArgs & { signal?: AbortSignal }): StreamSession {
  const provider = getProvider();
  const tier = args.tier ?? "main";
  const started = Date.now();
  const timeout = AbortSignal.timeout(STREAM_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
  const stream = provider.streamText({
    feature: args.feature,
    tier,
    system: args.system,
    prompt: args.prompt,
    maxOutputTokens: args.maxOutputTokens,
    fixture: args.fixture,
    signal,
  });

  return {
    chunks: stream.chunks,
    async finish(ok) {
      const tokens = await Promise.race([
        stream.usage,
        new Promise<TokenUsage>((resolve) => setTimeout(() => resolve({}), 500)),
      ]);
      await recordUsage({
        userId: args.userId,
        feature: args.feature,
        provider: provider.id,
        model: provider.modelName(tier),
        promptVersion: PROMPT_VERSIONS[args.feature],
        status: ok || args.signal?.aborted ? "SUCCESS" : "PROVIDER_ERROR",
        latencyMs: Date.now() - started,
        tokens,
      });
    },
  };
}

export const ASSISTANT_TIMEOUT_MS = 90_000;

export type AssistantSession = {
  events: AsyncIterable<AssistantTurnEvent>;
  /** Call once when the turn ended (ok) or broke (not ok). Records usage: one action per turn. */
  finish(ok: boolean): Promise<void>;
};

/**
 * Opens one assistant turn (feature 11 §4): the model may call the given tools, up to `maxSteps`
 * times. The caller reads `events`, then calls `finish`. A turn the person stopped counts as a
 * success: the provider worked and quota was used.
 */
export function runAssistantTurn(args: {
  userId: string;
  system: string;
  messages: ChatTurnMessage[];
  tools: AssistantTools;
  maxSteps: number;
  maxOutputTokens?: number;
  /** Plain-data copy of the request, for the mock provider only. */
  fixture?: unknown;
  signal?: AbortSignal;
}): AssistantSession {
  const provider = getProvider();
  const started = Date.now();
  const timeout = AbortSignal.timeout(ASSISTANT_TIMEOUT_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, timeout]) : timeout;
  const turn = provider.runAssistantTurn({
    system: args.system,
    messages: args.messages,
    tools: args.tools,
    maxSteps: args.maxSteps,
    maxOutputTokens: args.maxOutputTokens,
    fixture: args.fixture,
    signal,
  });
  return {
    events: turn.events,
    async finish(ok) {
      const tokens = await Promise.race([
        turn.usage,
        new Promise<TokenUsage>((resolve) => setTimeout(() => resolve({}), 500)),
      ]);
      await recordUsage({
        userId: args.userId,
        feature: "ASSISTANT",
        provider: provider.id,
        model: provider.modelName("main"),
        promptVersion: PROMPT_VERSIONS.ASSISTANT,
        status: ok || args.signal?.aborted ? "SUCCESS" : "PROVIDER_ERROR",
        latencyMs: Date.now() - started,
        tokens,
      });
    },
  };
}

export { PROMPT_VERSIONS };
