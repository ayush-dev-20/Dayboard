import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/lib/env-schema";

const base = {
  DATABASE_URL: "postgres://localhost:5432/dayboard",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://localhost:3000",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

const production = {
  ...base,
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://app.example.com",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
  RESEND_API_KEY: "re_test",
  EMAIL_FROM: "Dayboard <hello@example.com>",
};

function problems(
  source: Record<string, string | undefined>,
  options?: Parameters<typeof parseEnv>[1],
) {
  try {
    parseEnv(source, options);
    return [];
  } catch (error) {
    if (error instanceof EnvError) return error.problems;
    throw error;
  }
}

describe("parseEnv", () => {
  it("accepts a minimal development setup with no email or OAuth", () => {
    const env = parseEnv(base);
    expect(env.isProduction).toBe(false);
    expect(env.emailProvider).toBe("console");
    expect(env.emailVerificationRequired).toBe(false);
    expect(env.googleEnabled).toBe(false);
    expect(env.githubEnabled).toBe(false);
  });

  it("fails production when email delivery is not configured", () => {
    const list = problems({ ...production, RESEND_API_KEY: undefined, EMAIL_FROM: undefined });
    expect(list.join("\n")).toMatch(/RESEND_API_KEY: required in production/);
  });

  it("treats a blank RESEND_API_KEY as missing", () => {
    const list = problems({ ...production, RESEND_API_KEY: "   " });
    expect(list.join("\n")).toMatch(/RESEND_API_KEY/);
  });

  it("requires an https auth origin in production", () => {
    const list = problems({ ...production, BETTER_AUTH_URL: "http://app.example.com" });
    expect(list.join("\n")).toMatch(/BETTER_AUTH_URL: must be an https/);
  });

  it("accepts a complete production setup and enforces verification", () => {
    const env = parseEnv(production);
    expect(env.emailProvider).toBe("resend");
    expect(env.emailVerificationRequired).toBe(true);
  });

  it("lets E2E runs use the console sender in a production build, with verification still on", () => {
    const env = parseEnv({
      ...production,
      RESEND_API_KEY: undefined,
      EMAIL_FROM: undefined,
      E2E: "true",
    });
    expect(env.emailProvider).toBe("console");
    expect(env.e2e).toBe(true);
    expect(env.emailVerificationRequired).toBe(true);
  });

  it("skips production checks only when asked (the build phase)", () => {
    const loose = { ...base, NODE_ENV: "production" };
    expect(problems(loose).length).toBeGreaterThan(0);
    expect(problems(loose, { skipProductionChecks: true })).toEqual([]);
  });

  it("requires OAuth credentials as a pair", () => {
    expect(problems({ ...base, GOOGLE_CLIENT_ID: "id" }).join("\n")).toMatch(
      /Google sign-in: set both/,
    );
    expect(problems({ ...base, GITHUB_CLIENT_SECRET: "secret" }).join("\n")).toMatch(
      /GitHub sign-in: set both/,
    );
  });

  it("enables a provider only when both values are set", () => {
    const env = parseEnv({ ...base, GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" });
    expect(env.googleEnabled).toBe(true);
    expect(env.githubEnabled).toBe(false);
  });

  it("requires EMAIL_FROM when a Resend key is set", () => {
    expect(problems({ ...base, RESEND_API_KEY: "re_test" }).join("\n")).toMatch(/EMAIL_FROM/);
  });

  it("rejects a short auth secret and a non-postgres database URL", () => {
    const list = problems({ ...base, BETTER_AUTH_SECRET: "short", DATABASE_URL: "mysql://x" }).join(
      "\n",
    );
    expect(list).toMatch(/BETTER_AUTH_SECRET/);
    expect(list).toMatch(/DATABASE_URL/);
  });

  it("reports every problem at once", () => {
    expect(problems({}).length).toBeGreaterThanOrEqual(4);
  });
});
