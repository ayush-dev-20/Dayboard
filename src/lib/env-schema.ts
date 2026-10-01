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

  return {
    ...v,
    e2e,
    isProduction: v.NODE_ENV === "production",
    emailProvider,
    // Verification is enforced whenever mail is really sent, and in E2E runs so the flow is tested.
    emailVerificationRequired: emailProvider === "resend" || e2e,
    googleEnabled: Boolean(v.GOOGLE_CLIENT_ID && v.GOOGLE_CLIENT_SECRET),
    githubEnabled: Boolean(v.GITHUB_CLIENT_ID && v.GITHUB_CLIENT_SECRET),
  };
}

export type Env = ReturnType<typeof parseEnv>;
