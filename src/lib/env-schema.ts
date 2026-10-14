import { parseFallbackModels } from "./ai/providers/fallback";
import { z } from "zod";

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalString = z.preprocess(blankToUndefined, z.string().optional());

const rawSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "must be at least 32 characters (generate one with: openssl rand -base64 32)"),
  BETTER_AUTH_URL: z.url("must be a full URL such as http://localhost:3000"),
  NEXT_PUBLIC_APP_URL: z.url("must be a full URL such as http://localhost:3000"),
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  GITHUB_CLIENT_ID: optionalString,
  GITHUB_CLIENT_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: optionalString,
  E2E: optionalString,
  // Google Calendar (V2 feature 12). With none of these set, all calendar UI is hidden. The client can be the
  // sign-in client with one more redirect URI. TOKEN_ENCRYPTION_KEY is 32 bytes, base64.
  GOOGLE_CALENDAR_CLIENT_ID: optionalString,
  GOOGLE_CALENDAR_CLIENT_SECRET: optionalString,
  GOOGLE_CALENDAR_REDIRECT_URI: z.preprocess(
    blankToUndefined,
    z.url("must be a full URL").optional(),
  ),
  TOKEN_ENCRYPTION_KEY: optionalString,
  // The key used before a rotation, so tokens saved with it can still be read.
  TOKEN_ENCRYPTION_KEY_PREVIOUS: optionalString,
  // `mock` is for tests and local work without Google. E2E runs always use it.
  CALENDAR_PROVIDER: z.preprocess(blankToUndefined, z.enum(["google", "mock"]).optional()),
  // Background jobs (V2 feature 08). Concurrency and polling apply to the worker process only.
  WORKER_CONCURRENCY: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(16).default(4),
  ),
  WORKER_POLL_MS: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(200).max(60000).default(2000),
  ),
  // Comma-separated subset of the queues; empty means all of them.
  WORKER_QUEUES: optionalString,
  // Tick mode only (docs/decisions/0009). Unset means the tick endpoint answers 404.
  JOBS_TICK_SECRET: z.preprocess(
    blankToUndefined,
    z
      .string()
      .min(32, "must be at least 32 characters (generate one with: openssl rand -base64 32)")
      .optional(),
  ),
  // AI (feature 05). `mock` needs no key and is the default outside production.
  AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(["anthropic", "gemini", "mock"]).optional()),
  AI_MODEL: optionalString,
  AI_MODEL_FAST: optionalString,
  // Models to try, in order, when the chosen one cannot answer (quota, outage). `none` turns it off.
  AI_FALLBACK_MODELS: optionalString,
  // Meaning-based search (V2 feature 10, docs/decisions/0011). The embedding model, and the most chunks of
  // text one person's items may send to it for indexing in a day.
  AI_EMBEDDING_MODEL: optionalString,
  EMBED_DAILY_LIMIT: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(0).max(1_000_000).default(2000),
  ),
  AI_API_KEY: optionalString,
  AI_BASE_URL: z.preprocess(blankToUndefined, z.url("must be a full URL").optional()),
  AI_MOCK_MODE: z.preprocess(blankToUndefined, z.enum(["error", "slow"]).optional()),
  AI_LIMIT_PER_MINUTE: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(1000).default(10),
  ),
  AI_LIMIT_PER_DAY: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(100000).default(100),
  ),
  // Files (V2 feature 09). Empty means the feature is hidden. `s3` is any S3-compatible service
  // (Backblaze B2 in V2); `memory` is for tests; `disk` is for local development only.
  STORAGE_DRIVER: z.preprocess(blankToUndefined, z.enum(["s3", "memory", "disk"]).optional()),
  STORAGE_ENDPOINT: z.preprocess(blankToUndefined, z.url("must be a full URL").optional()),
  STORAGE_REGION: optionalString,
  STORAGE_BUCKET: optionalString,
  STORAGE_ACCESS_KEY_ID: optionalString,
  STORAGE_SECRET_ACCESS_KEY: optionalString,
  STORAGE_FORCE_PATH_STYLE: z.preprocess(
    blankToUndefined,
    z.enum(["true", "false"]).default("false"),
  ),
  STORAGE_DISK_DIR: optionalString,
  STORAGE_QUOTA_MB: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(500)),
  STORAGE_TOTAL_LIMIT_MB: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).default(9000),
  ),
});

export type ParseEnvOptions = {
  /** Used while `next build` runs without runtime secrets. Never use at runtime. */
  skipProductionChecks?: boolean;
};

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
        "See .env.example for every variable.",
    );
    this.name = "EnvError";
  }
}

export function parseEnv(
  source: Record<string, string | undefined>,
  options: ParseEnvOptions = {},
) {
  const result = rawSchema.safeParse(source);
  const problems: string[] = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${issue.path.join(".") || "env"}: ${issue.message}`);
    }
    throw new EnvError(problems);
  }

  const v = result.data;
  const e2e = v.E2E === "true";

  const pair = (a: keyof typeof v, b: keyof typeof v, label: string) => {
    if (Boolean(v[a]) !== Boolean(v[b])) {
      problems.push(`${label}: set both ${a} and ${b}, or neither`);
    }
  };
  pair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "Google sign-in");
  pair("GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET", "GitHub sign-in");

  if (v.RESEND_API_KEY && !v.EMAIL_FROM) {
    problems.push("EMAIL_FROM: required when RESEND_API_KEY is set");
  }

  // Files: with the S3 driver every connection value is needed. The disk driver writes to the local
  // file system, which production hosts (Vercel) do not keep, so it is development only.
  if (v.STORAGE_DRIVER === "s3") {
    for (const name of [
      "STORAGE_ENDPOINT",
      "STORAGE_REGION",
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
    ] as const) {
      if (!v[name]) problems.push(`${name}: required when STORAGE_DRIVER is s3`);
    }
  }
  if (
    v.STORAGE_DRIVER === "disk" &&
    v.NODE_ENV === "production" &&
    !e2e &&
    !options.skipProductionChecks
  ) {
    problems.push("STORAGE_DRIVER: disk is for local development only; use s3 in production");
  }

  if (v.NODE_ENV === "production" && !e2e && !options.skipProductionChecks) {
    if (!v.RESEND_API_KEY) {
      problems.push(
        "RESEND_API_KEY: required in production (magic link and password reset need email delivery)",
      );
    }
    if (!v.BETTER_AUTH_URL.startsWith("https://")) {
      problems.push("BETTER_AUTH_URL: must be an https:// origin in production");
    }
  }

  // Unknown queue names are refused at startup, so a typo never leaves a queue unserved.
  const queueNames = ["default", "ai", "notifications"];
  const workerQueues = (v.WORKER_QUEUES ?? "")
    .split(",")
    .map((q) => q.trim())
    .filter(Boolean);
  for (const name of workerQueues) {
    if (!queueNames.includes(name)) problems.push(`WORKER_QUEUES: unknown queue "${name}"`);
  }

  // Calendar: the key must be 32 bytes of base64, and a real provider needs every Google value.
  const decodesTo32 = (value: string | undefined) =>
    value === undefined || Buffer.from(value, "base64").length === 32;
  if (!decodesTo32(v.TOKEN_ENCRYPTION_KEY)) {
    problems.push("TOKEN_ENCRYPTION_KEY: must be 32 bytes, base64 (openssl rand -base64 32)");
  }
  if (!decodesTo32(v.TOKEN_ENCRYPTION_KEY_PREVIOUS)) {
    problems.push("TOKEN_ENCRYPTION_KEY_PREVIOUS: must be 32 bytes, base64");
  }
  const googleCalendarConfigured = Boolean(
    v.GOOGLE_CALENDAR_CLIENT_ID &&
    v.GOOGLE_CALENDAR_CLIENT_SECRET &&
    v.GOOGLE_CALENDAR_REDIRECT_URI,
  );
  if (v.GOOGLE_CALENDAR_CLIENT_ID && !googleCalendarConfigured) {
    problems.push(
      "Google Calendar: set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET and GOOGLE_CALENDAR_REDIRECT_URI together",
    );
  }

  // Every problem found above is reported together, before anything is built from the values.
  if (problems.length > 0) throw new EnvError(problems);

  // E2E runs never reach Google. Otherwise the provider is the one asked for, or Google when it is set up.
  const calendarProvider: "google" | "mock" | null = e2e
    ? "mock"
    : (v.CALENDAR_PROVIDER ?? (googleCalendarConfigured ? "google" : null));
  // Calendar needs a provider and a key to encrypt refresh tokens with. Without both, the UI is hidden.
  const calendarAvailable =
    calendarProvider !== null &&
    Boolean(v.TOKEN_ENCRYPTION_KEY) &&
    (calendarProvider === "mock" || googleCalendarConfigured);

  const emailProvider: "resend" | "console" = v.RESEND_API_KEY ? "resend" : "console";

  // An E2E run never reaches a real bucket. No driver means no files anywhere in the app.
  const storageDriver: "s3" | "memory" | "disk" | null = e2e
    ? "memory"
    : (v.STORAGE_DRIVER ?? null);

  // Real model calls never happen in tests: an E2E run is always the mock. Otherwise the mock is
  // the default everywhere except production, where a real provider is expected.
  const aiProvider: "anthropic" | "gemini" | "mock" = e2e
    ? "mock"
    : (v.AI_PROVIDER ?? (v.NODE_ENV === "production" ? "anthropic" : "mock"));
  // A real provider without a key means AI is switched off for everyone; the rest of the app works.
  const aiAvailable = aiProvider === "mock" || Boolean(v.AI_API_KEY);
  // Only Google (and the mock) can embed text. With Anthropic, search stays keyword-only.
  const embeddingsAvailable = aiAvailable && (aiProvider === "gemini" || aiProvider === "mock");
  // null means "use the built-in list for this vendor"; an empty list means no fallback at all.
  const aiFallbackModels = parseFallbackModels(v.AI_FALLBACK_MODELS);

  return {
    ...v,
    workerQueues: workerQueues.length > 0 ? workerQueues : queueNames,
    e2e,
    isProduction: v.NODE_ENV === "production",
    emailProvider,
    // Verification is enforced whenever mail is really sent, and in E2E runs so the flow is tested.
    emailVerificationRequired: emailProvider === "resend" || e2e,
    aiProvider,
    aiAvailable,
    embeddingsAvailable,
    calendarProvider,
    calendarAvailable,
    aiFallbackModels,
    storageDriver,
    storageAvailable: storageDriver !== null,
    storageForcePathStyle: v.STORAGE_FORCE_PATH_STYLE === "true",
    storageQuotaBytes: v.STORAGE_QUOTA_MB * 1024 * 1024,
    storageTotalLimitBytes: v.STORAGE_TOTAL_LIMIT_MB * 1024 * 1024,
    googleEnabled: Boolean(v.GOOGLE_CLIENT_ID && v.GOOGLE_CLIENT_SECRET),
    githubEnabled: Boolean(v.GITHUB_CLIENT_ID && v.GITHUB_CLIENT_SECRET),
  };
}

export type Env = ReturnType<typeof parseEnv>;
