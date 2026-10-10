import type { z } from "zod";
import type { AIFeature, ModelTier, TokenUsage } from "./types";
import type { ChatTurnMessage } from "./assistant-types";

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

// ---- The assistant's turn: a model that may call tools (feature 11 §4) -------------------------

/** What a tool hands back: text for the model, and the same items as plain data for the mock. */
export type ToolResult = {
  text: string;
  items?: { label: string; type: string; id: string; title: string; body: string }[];
};

/**
 * An application command the model may call. `execute` is the owner-scoped implementation; the
 * provider validates the model's arguments against `inputSchema` before calling it.
 */
export type AssistantTool = {
  description: string;
  inputSchema: z.ZodType;
  execute(input: unknown): Promise<ToolResult>;
};
export type AssistantTools = Record<string, AssistantTool>;

export type AssistantTurnOptions = {
  system: string;
  /** Recent history, oldest first; the last message is the new question (already framed). */
  messages: ChatTurnMessage[];
  tools: AssistantTools;
  /** At most this many tool steps; the model then has to answer. */
  maxSteps: number;
  maxOutputTokens?: number;
  signal: AbortSignal;
  /** The same request as plain data, for the mock provider's script. Real providers ignore it. */
  fixture?: unknown;
};

export type AssistantTurnEvent =
  { type: "text"; delta: string } | { type: "tool"; name: string; status: "start" | "done" };

export type AssistantTurn = {
  events: AsyncIterable<AssistantTurnEvent>;
  /** Resolves when the turn has ended. */
  usage: Promise<TokenUsage>;
};

export interface AIProvider {
  readonly id: "anthropic" | "gemini" | "mock";
  modelName(tier: ModelTier): string;
  /** The raw model answer. The caller validates it; a provider only has to return JSON-shaped data. */
  generateStructured(options: CallOptions, schema: z.ZodType): Promise<StructuredResult>;
  streamText(options: CallOptions): TextStream;
  /** A multi-step turn that may call the given tools (feature 11). */
  runAssistantTurn(options: AssistantTurnOptions): AssistantTurn;
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
