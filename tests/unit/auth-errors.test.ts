import { describe, expect, it } from "vitest";
import { describeAuthError } from "@/lib/auth-errors";

describe("describeAuthError", () => {
  it("maps wrong credentials without saying which part was wrong", () => {
    const result = describeAuthError({ status: 401, code: "INVALID_EMAIL_OR_PASSWORD" });
    expect(result).toEqual({
      kind: "invalid-credentials",
      message: "Email or password is incorrect.",
    });
  });

  it("recognises an unverified email", () => {
    expect(describeAuthError({ status: 403, code: "EMAIL_NOT_VERIFIED" }).kind).toBe(
      "email-not-verified",
    );
    expect(describeAuthError({ status: 403, message: "Email not verified" }).kind).toBe(
      "email-not-verified",
    );
  });

  it("recognises rate limiting", () => {
    expect(describeAuthError({ status: 429 }).kind).toBe("rate-limited");
  });

  it("never reveals that an account already exists", () => {
    const result = describeAuthError({ status: 422, code: "USER_ALREADY_EXISTS" });
    expect(result.kind).toBe("cannot-create");
    expect(result.message.toLowerCase()).not.toContain("already exists");
  });

  it("recognises expired or used tokens", () => {
    expect(describeAuthError({ status: 400, code: "INVALID_TOKEN" }).kind).toBe("invalid-token");
  });

  it("treats a missing status as a network problem", () => {
    expect(describeAuthError({ message: "Failed to fetch" }).kind).toBe("network");
  });

  it("falls back to a plain message and never leaks technical text", () => {
    const result = describeAuthError({
      status: 500,
      code: "SOMETHING_ODD",
      message: "stack trace here",
    });
    expect(result.kind).toBe("unknown");
    expect(result.message).toBe("Something went wrong. Try again.");
    expect(describeAuthError(null).message).toBe("Something went wrong. Try again.");
  });
});
