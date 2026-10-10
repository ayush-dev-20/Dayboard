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
  // AI (feature 05). `mock` needs no key and is the default outside production.
  AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(["anthropic", "gemini", "mock"]).optional()),
  AI_MODEL: optionalString,
  AI_MODEL_FAST: optionalString,
  // Models to try, in order, when the chosen one cannot answer (quota, outage). `none` turns it off.
  AI_FALLBACK_MODELS: optionalString,
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

  if (problems.length > 0) throw new EnvError(problems);

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
  // null means "use the built-in list for this vendor"; an empty list means no fallback at all.
  const aiFallbackModels = parseFallbackModels(v.AI_FALLBACK_MODELS);

  return {
    ...v,
    e2e,
    isProduction: v.NODE_ENV === "production",
    emailProvider,
    // Verification is enforced whenever mail is really sent, and in E2E runs so the flow is tested.
    emailVerificationRequired: emailProvider === "resend" || e2e,
    aiProvider,
    aiAvailable,
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
