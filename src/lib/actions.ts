import "server-only";
import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { AppError, type ErrorCode, type FieldErrors } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type ActionError = { code: ErrorCode; message: string; fieldErrors?: FieldErrors };
export type ActionResult<T = void> = { ok: true; data: T } | { ok: false; error: ActionError };

function fieldErrorsFromZod(error: ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Wraps a Server Action body so it always returns a plain result instead of throwing (thrown errors
 * are scrubbed in production). Validation problems become field errors; unexpected errors are
 * logged with a request id and shown as a friendly message.
 */
export async function runAction<T>(
  feature: string,
  body: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await body() };
  } catch (error) {
    unstable_rethrow(error); // redirect()/notFound() must keep working

    if (error instanceof ZodError) {
      const fieldErrors = fieldErrorsFromZod(error);
      const first = Object.values(fieldErrors)[0];
      return {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: first ?? "Some details need another look.",
          fieldErrors,
        },
      };
    }
    if (error instanceof AppError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message, fieldErrors: error.fieldErrors },
      };
    }

    const requestId = (await headers().catch(() => null))?.get("x-request-id") ?? undefined;
    logger.error("action failed", { feature, requestId, error });
    return {
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Something went wrong on our side. Try again." },
    };
  }
}
