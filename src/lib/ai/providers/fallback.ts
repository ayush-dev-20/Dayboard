import type { ModelTier } from "../types";

// Model fallback (V2 feature 11 follow-up). When the model a call asked for cannot answer right now
// (free quota used up, overloaded, retired), the same call goes to the next model in a short list.
// Pure and free of the SDK, so the rules are tested without a network.

export type Vendor = "anthropic" | "gemini";

/**
 * The models tried after the tier's own model, in order. Free-tier limits belong to each model, so
 * moving to another model usually means a separate allowance.
 */
export const DEFAULT_FALLBACKS: Record<Vendor, Record<ModelTier, readonly string[]>> = {
  gemini: {
    main: ["gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
    fast: ["gemini-2.5-flash-lite", "gemini-2.5-flash"],
  },
  anthropic: {
    main: ["claude-haiku-4-5-20251001"],
    fast: [],
  },
};

/** The model a tier asks for first, then its fallbacks, without repeats. */
export function modelChain(primary: string, fallbacks: readonly string[]): string[] {
  return [...new Set([primary, ...fallbacks])];
}

/** `AI_FALLBACK_MODELS`: a comma list, `none` for no fallback, and unset for the defaults. */
export function parseFallbackModels(raw: string | undefined): string[] | null {
  if (raw === undefined) return null;
  const list = raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (list.length === 1 && list[0]!.toLowerCase() === "none") return [];
  return list;
}

type Errorish = {
  statusCode?: unknown;
  status?: unknown;
  code?: unknown;
  name?: unknown;
  cause?: unknown;
};

/** The HTTP status carried by an error or by what caused it. */
export function statusOf(error: unknown): number | undefined {
  let current = error as Errorish | null | undefined;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const status = current.statusCode ?? current.status;
    if (typeof status === "number") return status;
    current = current.cause as Errorish | null | undefined;
  }
  return undefined;
}

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * Can another model do what this one could not? Yes for "try later" kinds of failure: the quota or
 * rate limit (429), the service's own errors (5xx), a timeout, a dropped connection, or a model that
 * is not available (404). No for a bad request (400), a key that is refused (401, 403), or an answer
 * the SDK could not read: another model would fail the same way, or the cause is ours.
 */
export function canFallBack(error: unknown): boolean {
  const status = statusOf(error);
  if (status !== undefined) {
    return status === 429 || status === 404 || status === 408 || status >= 500;
  }
  let current = error as Errorish | null | undefined;
  for (let depth = 0; current && depth < 4; depth += 1) {
    const name = typeof current.name === "string" ? current.name : "";
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (typeof current.code === "string" && NETWORK_CODES.has(current.code)) return true;
    if (
      name === "TypeError" &&
      /fetch failed/i.test(String((current as { message?: unknown }).message))
    ) {
      return true;
    }
    current = current.cause as Errorish | null | undefined;
  }
  return false;
}

/** How long to leave a model alone after it failed: its quota resets slowly, an outage is short. */
export function cooldownFor(error: unknown): number {
  const status = statusOf(error);
  if (status === 429) return 5 * 60_000;
  if (status === 404) return 60 * 60_000;
  if (status !== undefined && status >= 500) return 60_000;
  return 30_000;
}

/**
 * Remembers which models just failed, so the next calls start with one that works instead of waiting
 * for the same error again. In memory, per server instance: a restart or a new instance simply
 * tries the first model again, which is always safe.
 */
export class CooldownBook {
  private readonly until = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  note(model: string, error: unknown): void {
    this.until.set(model, this.now() + cooldownFor(error));
  }

  clear(model: string): void {
    this.until.delete(model);
  }

  isCooling(model: string): boolean {
    const end = this.until.get(model);
    if (end === undefined) return false;
    if (end <= this.now()) {
      this.until.delete(model);
      return false;
    }
    return true;
  }

  /** Models that are not cooling come first, in their order; cooling ones go last, so nothing is skipped for good. */
  order(models: readonly string[]): string[] {
    const ready = models.filter((m) => !this.isCooling(m));
    const resting = models.filter((m) => this.isCooling(m));
    return [...ready, ...resting];
  }
}

/**
 * Runs `attempt` on each model in turn until one answers. Moves on only when `canFallBack` allows it
 * and the person has not stopped the call. The last error is thrown if every model fails.
 */
export async function firstThatWorks<T>(
  models: readonly string[],
  book: CooldownBook,
  signal: AbortSignal,
  attempt: (model: string) => Promise<T>,
  onFallback?: (from: string, to: string, error: unknown) => void,
): Promise<{ value: T; model: string }> {
  const order = book.order(models);
  let lastError: unknown;
  for (let i = 0; i < order.length; i += 1) {
    const model = order[i]!;
    try {
      const value = await attempt(model);
      book.clear(model);
      return { value, model };
    } catch (error) {
      lastError = error;
      const next = order[i + 1];
      if (next === undefined || signal.aborted || !canFallBack(error)) throw error;
      book.note(model, error);
      onFallback?.(model, next, error);
    }
  }
  throw lastError;
}
