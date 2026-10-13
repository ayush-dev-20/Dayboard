import { describe, expect, it } from "vitest";
import { sameSecret } from "@/lib/jobs/secret";

describe("sameSecret", () => {
  it("accepts the same secret and refuses anything else, whatever its length", () => {
    const secret = "integration-tick-secret-0123456789abcdef";
    expect(sameSecret(secret, secret)).toBe(true);
    expect(sameSecret("", secret)).toBe(false);
    expect(sameSecret(secret + "x", secret)).toBe(false);
    expect(sameSecret(secret.slice(1), secret)).toBe(false);
    expect(sameSecret("a", "b")).toBe(false);
  });
});
