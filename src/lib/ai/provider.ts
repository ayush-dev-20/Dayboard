import type { z } from "zod";
import type { AIFeature, ModelTier, TokenUsage } from "./types";

// The seam between Dayboard and any model provider. Feature code only ever sees this interface;
// the Vercel AI SDK is used inside `providers/sdk.ts` and nowhere else.

export type CallOptions = {
  feature: AIFeature;
  tier: ModelTier;
  system: string;
  prompt: string;
  /** Most tokens the model may write. Left to the vendor's default when absent. */
  maxOutputTokens?: number;
  /** Stops the call, for timeouts and for a person who closed the panel. */
  signal: AbortSignal;
  /**
   * The same request as plain data, for the mock provider's fixtures. Real providers ignore it, so
   * a fixture can be built without parsing the prompt text.
   */
  fixture?: unknown;
};

export type StructuredResult = { output: unknown; usage: TokenUsage };

export type TextStream = {
  chunks: AsyncIterable<string>;
  /** Resolves when the stream has ended. */
  usage: Promise<TokenUsage>;
};

export interface AIProvider {
  readonly id: "anthropic" | "gemini" | "mock";
  modelName(tier: ModelTier): string;
  /** The raw model answer. The caller validates it; a provider only has to return JSON-shaped data. */
  generateStructured(options: CallOptions, schema: z.ZodType): Promise<StructuredResult>;
  streamText(options: CallOptions): TextStream;
}

/** A failure that is the provider's fault (5xx, timeout, network), as opposed to bad output. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}
