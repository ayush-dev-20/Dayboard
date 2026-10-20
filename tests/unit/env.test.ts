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

describe("storage settings (V2 feature 09)", () => {
  const s3 = {
    STORAGE_DRIVER: "s3",
    STORAGE_ENDPOINT: "https://s3.us-west-004.backblazeb2.com",
    STORAGE_REGION: "us-west-004",
    STORAGE_BUCKET: "dayboard-files-abc",
    STORAGE_ACCESS_KEY_ID: "keyid",
    STORAGE_SECRET_ACCESS_KEY: "secret",
  };

  it("an unset driver means the feature is off, in development and in production", () => {
    expect(parseEnv(base).storageDriver).toBeNull();
    expect(parseEnv(base).storageAvailable).toBe(false);
    expect(problems(production)).toEqual([]);
    expect(parseEnv(production).storageAvailable).toBe(false);
  });

  it("the s3 driver needs all five connection values", () => {
    expect(problems({ ...base, ...s3 })).toEqual([]);
    const env = parseEnv({ ...base, ...s3 });
    expect(env.storageDriver).toBe("s3");
    expect(env.storageAvailable).toBe(true);
    for (const name of [
      "STORAGE_ENDPOINT",
      "STORAGE_REGION",
      "STORAGE_BUCKET",
      "STORAGE_ACCESS_KEY_ID",
      "STORAGE_SECRET_ACCESS_KEY",
    ]) {
      const missing = { ...base, ...s3, [name]: "" };
      expect(problems(missing).join("\n")).toContain(`${name}: required when STORAGE_DRIVER is s3`);
    }
  });

  it("E2E forces the in-memory store, so a test never reaches a real bucket", () => {
    const env = parseEnv({ ...base, ...s3, E2E: "true" });
    expect(env.storageDriver).toBe("memory");
    expect(parseEnv({ ...base, E2E: "true" }).storageDriver).toBe("memory");
  });

  it("the disk driver is for development only", () => {
    expect(problems({ ...base, STORAGE_DRIVER: "disk" })).toEqual([]);
    expect(problems({ ...production, STORAGE_DRIVER: "disk" }).join("\n")).toContain(
      "disk is for local development only",
    );
  });

  it("reads the quotas in megabytes, with defaults, and path style as a boolean", () => {
    const env = parseEnv(base);
    expect(env.storageQuotaBytes).toBe(500 * 1024 * 1024);
    expect(env.storageTotalLimitBytes).toBe(9000 * 1024 * 1024);
    expect(env.storageForcePathStyle).toBe(false);
    const custom = parseEnv({
      ...base,
      STORAGE_QUOTA_MB: "50",
      STORAGE_TOTAL_LIMIT_MB: "100",
      STORAGE_FORCE_PATH_STYLE: "true",
    });
    expect(custom.storageQuotaBytes).toBe(50 * 1024 * 1024);
    expect(custom.storageTotalLimitBytes).toBe(100 * 1024 * 1024);
    expect(custom.storageForcePathStyle).toBe(true);
  });
});

describe("AI_FALLBACK_MODELS", () => {
  it("is unset by default, so the built-in model list is used", () => {
    expect(parseEnv(base).aiFallbackModels).toBeNull();
    expect(parseEnv({ ...base, AI_FALLBACK_MODELS: "  " }).aiFallbackModels).toBeNull();
  });

  it("reads a comma list in order, and `none` as no fallback at all", () => {
    expect(
      parseEnv({ ...base, AI_FALLBACK_MODELS: "gemini-2.5-flash, gemini-2.5-flash-lite" })
        .aiFallbackModels,
    ).toEqual(["gemini-2.5-flash", "gemini-2.5-flash-lite"]);
    expect(parseEnv({ ...base, AI_FALLBACK_MODELS: "none" }).aiFallbackModels).toEqual([]);
  });

  describe("calendar (feature 12)", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    const google = {
      GOOGLE_CALENDAR_CLIENT_ID: "id",
      GOOGLE_CALENDAR_CLIENT_SECRET: "secret",
      GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/api/calendar/google/callback",
    };

    it("is off with nothing set, so the calendar UI is hidden and the app is unchanged", () => {
      const env = parseEnv(base);
      expect(env.calendarAvailable).toBe(false);
      expect(env.calendarProvider).toBeNull();
    });

    it("is on with every Google value and a key, and off with Google but no key", () => {
      expect(parseEnv({ ...base, ...google, TOKEN_ENCRYPTION_KEY: key })).toMatchObject({
        calendarAvailable: true,
        calendarProvider: "google",
      });
      expect(parseEnv({ ...base, ...google }).calendarAvailable).toBe(false);
    });

    it("refuses a half-set Google client, and a key that is not 32 bytes", () => {
      expect(
        problems({ ...base, GOOGLE_CALENDAR_CLIENT_ID: "id", TOKEN_ENCRYPTION_KEY: key }),
      ).toEqual([
        expect.stringContaining(
          "set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET and GOOGLE_CALENDAR_REDIRECT_URI together",
        ),
      ]);
      expect(
        problems({ ...base, ...google, TOKEN_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") }),
      ).toEqual([expect.stringContaining("TOKEN_ENCRYPTION_KEY: must be 32 bytes")]);
      expect(
        problems({
          ...base,
          ...google,
          TOKEN_ENCRYPTION_KEY: key,
          TOKEN_ENCRYPTION_KEY_PREVIOUS: "nope",
        }),
      ).toEqual([expect.stringContaining("TOKEN_ENCRYPTION_KEY_PREVIOUS")]);
    });

    it("uses the mock when asked, and always in an E2E run", () => {
      expect(
        parseEnv({ ...base, CALENDAR_PROVIDER: "mock", TOKEN_ENCRYPTION_KEY: key }),
      ).toMatchObject({
        calendarAvailable: true,
        calendarProvider: "mock",
      });
      expect(
        parseEnv({ ...base, ...google, E2E: "true", TOKEN_ENCRYPTION_KEY: key }).calendarProvider,
      ).toBe("mock");
    });

    it("reports a bad worker queue as a startup problem (it used to be ignored)", () => {
      expect(problems({ ...base, WORKER_QUEUES: "default,nope" })).toEqual([
        expect.stringContaining('unknown queue "nope"'),
      ]);
    });
  });

  describe("push (V2 feature 14)", () => {
    const keys = {
      VAPID_PUBLIC_KEY: "BPublic",
      VAPID_PRIVATE_KEY: "private",
      VAPID_SUBJECT: "mailto:ops@example.com",
    };

    it("is off with none of the VAPID values", () => {
      const env = parseEnv(base);
      expect(env.pushProvider).toBeNull();
      expect(env.pushAvailable).toBe(false);
    });

    it("is on with all three", () => {
      const env = parseEnv({ ...base, ...keys });
      expect(env.pushProvider).toBe("web-push");
      expect(env.pushAvailable).toBe(true);
    });

    it("refuses a half-set key pair and names it", () => {
      expect(problems({ ...base, VAPID_PUBLIC_KEY: "BPublic" }).join("\n")).toMatch(
        /VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT together/,
      );
    });

    it("wants a subject that is a mailto: or https: address", () => {
      expect(problems({ ...base, ...keys, VAPID_SUBJECT: "ops@example.com" }).join("\n")).toMatch(
        /VAPID_SUBJECT: must start with/,
      );
      expect(problems({ ...base, ...keys, VAPID_SUBJECT: "https://example.com/contact" })).toEqual(
        [],
      );
    });

    it("uses the mock when asked, and always in an E2E run", () => {
      expect(parseEnv({ ...base, PUSH_PROVIDER: "mock" }).pushAvailable).toBe(true);
      const e2e = parseEnv({ ...base, ...keys, E2E: "true" });
      expect(e2e.pushProvider).toBe("mock");
    });
  });
});
