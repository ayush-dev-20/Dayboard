export const ERROR_CODES = [
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "RATE_LIMITED",
  "AI_DISABLED",
  "AI_PROVIDER_ERROR",
  "DATABASE_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  AI_DISABLED: 403,
  AI_PROVIDER_ERROR: 502,
  DATABASE_ERROR: 500,
  INTERNAL_ERROR: 500,
};

// Plain-language defaults. Technical terms never reach the user (UI/UX spec §26).
const DEFAULT_MESSAGE: Record<ErrorCode, string> = {
  UNAUTHENTICATED: "Please sign in to continue.",
  UNAUTHORIZED: "You don't have access to that.",
  NOT_FOUND: "We couldn't find that.",
  VALIDATION_ERROR: "Some details need another look.",
  CONFLICT: "That can't be done right now.",
  RATE_LIMITED: "Too many attempts. Try again in a moment.",
  AI_DISABLED: "AI features are turned off.",
  AI_PROVIDER_ERROR: "The AI service didn't respond. Try again.",
  DATABASE_ERROR: "Something went wrong on our side. Try again.",
  INTERNAL_ERROR: "Something went wrong on our side. Try again.",
};

export type FieldErrors = Record<string, string>;

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly fieldErrors?: FieldErrors;
  readonly retryAfterSeconds?: number;

  constructor(
    code: ErrorCode,
    message?: string,
    options?: { fieldErrors?: FieldErrors; cause?: unknown; retryAfterSeconds?: number },
  ) {
    super(message ?? DEFAULT_MESSAGE[code], { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = HTTP_STATUS[code];
    this.fieldErrors = options?.fieldErrors;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }
}

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    fieldErrors?: FieldErrors;
    requestId?: string;
    /** Only on RATE_LIMITED: how long until the same request can work. */
    retryAfterSeconds?: number;
  };
};

export function toErrorBody(error: unknown, requestId?: string): ErrorBody {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        requestId,
        retryAfterSeconds: error.retryAfterSeconds,
      },
    };
  }
  return { error: { code: "INTERNAL_ERROR", message: DEFAULT_MESSAGE.INTERNAL_ERROR, requestId } };
}

export function toErrorResponse(error: unknown, requestId?: string): Response {
  const status = error instanceof AppError ? error.httpStatus : 500;
  const headers =
    error instanceof AppError && error.retryAfterSeconds
      ? { "Retry-After": String(error.retryAfterSeconds) }
      : undefined;
  return Response.json(toErrorBody(error, requestId), { status, headers });
}
