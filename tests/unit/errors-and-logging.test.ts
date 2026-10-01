import { describe, expect, it } from "vitest";
import { AppError, ERROR_CODES, toErrorBody } from "@/lib/errors";
import { redact } from "@/lib/logger";

describe("AppError", () => {
  it("covers every code from the technical spec", () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        "AI_DISABLED",
        "AI_PROVIDER_ERROR",
        "CONFLICT",
        "DATABASE_ERROR",
        "INTERNAL_ERROR",
        "NOT_FOUND",
        "RATE_LIMITED",
        "UNAUTHENTICATED",
        "UNAUTHORIZED",
        "VALIDATION_ERROR",
      ].sort(),
    );
  });

  it("maps codes to HTTP statuses", () => {
    expect(new AppError("UNAUTHENTICATED").httpStatus).toBe(401);
    expect(new AppError("NOT_FOUND").httpStatus).toBe(404);
    expect(new AppError("RATE_LIMITED").httpStatus).toBe(429);
    expect(new AppError("INTERNAL_ERROR").httpStatus).toBe(500);
  });

  it("has a plain-language default for every code, with no jargon", () => {
    for (const code of ERROR_CODES) {
      const message = new AppError(code).message;
      expect(message.length).toBeGreaterThan(8);
      expect(message).not.toMatch(/mutation|entity|exception|stack|undefined/i);
    }
  });
});

describe("toErrorBody", () => {
  it("returns the documented shape", () => {
    const body = toErrorBody(
      new AppError("VALIDATION_ERROR", "The task title is required."),
      "req-1",
    );
    expect(body).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "The task title is required.",
        requestId: "req-1",
      },
    });
  });

  it("hides unexpected errors behind INTERNAL_ERROR (no stack, no message)", () => {
    const body = toErrorBody(new Error("connection string postgres://user:secret@db/app failed"));
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});

describe("redact", () => {
  it("masks sensitive keys at any depth", () => {
    const out = redact({
      userId: "u1",
      password: "hunter2",
      nested: { sessionToken: "abc", apiKey: "k", authorization: "Bearer x", ok: 1 },
      list: [{ cookie: "c=1" }],
      magicLink: "http://x/verify?token=abc",
      callbackUrl: "http://x",
    }) as Record<string, unknown>;

    expect(out.userId).toBe("u1");
    expect(out.password).toBe("[redacted]");
    expect(out.magicLink).toBe("[redacted]");
    expect(out.callbackUrl).toBe("[redacted]");
    expect(out.nested).toEqual({
      sessionToken: "[redacted]",
      apiKey: "[redacted]",
      authorization: "[redacted]",
      ok: 1,
    });
    expect(out.list).toEqual([{ cookie: "[redacted]" }]);
  });

  it("serialises errors without losing the message", () => {
    const out = redact({ error: new Error("boom") }) as {
      error: { message: string; name: string };
    };
    expect(out.error.message).toBe("boom");
    expect(out.error.name).toBe("Error");
  });
});
