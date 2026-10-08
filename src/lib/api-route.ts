import "server-only";
import type { z } from "zod";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";

// The small shared part of the JSON route handlers (feature 09): read a body, check it with Zod,
// and turn any error into the app's one error shape. A route calls `handle` around its work.

export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  // A browser form cannot send this type cross-site without a preflight, so a forged page can't call us.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    throw new AppError("VALIDATION_ERROR", "That request wasn't readable.");
  }
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError("VALIDATION_ERROR", "That request wasn't readable.");
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) {
    fieldErrors[issue.path.map(String).join(".") || "_"] ??= issue.message;
  }
  throw new AppError("VALIDATION_ERROR", Object.values(fieldErrors)[0], { fieldErrors });
}

export async function handle(feature: string, work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof AppError)) logger.error(`${feature} failed`, { error });
    return toErrorResponse(error);
  }
}
