import "server-only";
import type { z } from "zod";
import { getPreferences } from "@/lib/preferences";
import { getUserToday } from "@/lib/dates/today";
import { AppError, toErrorResponse, type FieldErrors } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { requireUser, type CurrentUser } from "@/lib/session";
import { getProvider, isAIAvailable, PROMPT_VERSIONS } from "./index";
import { checkLimits } from "./usage";
import type { AIFeature, StreamEvent } from "./types";
import type { UserPreferences } from "@/db/schema";

// The front half of the request pipeline every route under `src/app/api/ai/` shares (feature doc
// §4, steps 1 to 4). Steps 5 to 8 are in each route, because they depend on the feature.

export type AIContext = {
  user: CurrentUser;
  prefs: UserPreferences;
  timezone: string;
  /** The person's current day as "YYYY-MM-DD". */
  today: string;
};

/** Is AI usable for this person right now? Throws `AI_DISABLED` when it is not. */
export async function requireAIEnabled(user: CurrentUser): Promise<UserPreferences> {
  const prefs = await getPreferences(user.id);
  if (!isAIAvailable() || !prefs.aiEnabled) throw new AppError("AI_DISABLED");
  return prefs;
}

async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "That request wasn't readable.");
  }
}

export function parseInput<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const fieldErrors: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[issue.path.map(String).join(".") || "_"] ??= issue.message;
  }
  throw new AppError("VALIDATION_ERROR", Object.values(fieldErrors)[0], { fieldErrors });
}

/** Steps 1 and 2: who is asking, and is AI on for them. */
export async function authorize(): Promise<{ user: CurrentUser; prefs: UserPreferences }> {
  const user = await requireUser();
  const prefs = await requireAIEnabled(user);
  return { user, prefs };
}

function contextFor(user: CurrentUser, prefs: UserPreferences): AIContext {
  return {
    user,
    prefs,
    timezone: prefs.timezone,
    today: getUserToday({ timezone: prefs.timezone, startOfDay: prefs.startOfDay }),
  };
}

/** Step 4: throws `RATE_LIMITED` (and records the blocked attempt) when over a limit. */
export async function enforceLimits(ctx: AIContext, feature: AIFeature): Promise<void> {
  const provider = getProvider();
  await checkLimits(ctx.user.id, ctx.timezone, {
    feature,
    provider: provider.id,
    model: provider.modelName("main"),
    promptVersion: PROMPT_VERSIONS[feature],
  });
}

/**
 * Steps 1 to 4 for a route with a request body. Pass `null` for a route with no body (GET).
 */
export async function openGate<S extends z.ZodType>(
  request: Request,
  feature: AIFeature,
  schema: S | null,
): Promise<{ ctx: AIContext; input: z.infer<S> }> {
  const { user, prefs } = await authorize();
  const input = (schema ? parseInput(schema, await readBody(request)) : undefined) as z.infer<S>;
  const ctx = contextFor(user, prefs);
  await enforceLimits(ctx, feature);
  return { ctx, input };
}

export { contextFor };

/** Turns anything thrown in a route into the shared JSON error shape. Prompts are never logged. */
export async function aiRoute(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof AppError)) logger.error("ai route failed", { error });
    return toErrorResponse(error);
  }
}

export function jsonOk<T>(data: T): Response {
  return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
}

const encoder = new TextEncoder();
export const encodeEvent = (event: StreamEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

/** A streamed response: one JSON event per line. Errors after the start become an `error` event. */
export function ndjsonResponse(
  produce: (send: (event: StreamEvent) => void) => Promise<void>,
): Response {
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: StreamEvent) => {
        try {
          controller.enqueue(encodeEvent(event));
        } catch {
          // The reader went away.
        }
      };
      try {
        await produce(send);
        send({ type: "done" });
      } catch (error) {
        if (!(error instanceof AppError)) logger.warn("ai stream failed", { error });
        const code = error instanceof AppError ? error.code : "AI_PROVIDER_ERROR";
        send({ type: "error", code, message: "Couldn’t get an answer. Try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      }
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
