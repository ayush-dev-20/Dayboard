import { describe, expect, it } from "vitest";
import { presenceColor, presenceInitials } from "@/lib/collab/presence";
import { TOKEN_TTL_MS, signCollabToken, verifyCollabToken } from "@/lib/collab/token";

const SECRET = "s".repeat(40);
const claims = { userId: "u1", noteId: "n1", role: "edit" as const };

describe("collaboration tokens", () => {
  it("round trip with the claims", () => {
    const token = signCollabToken(claims, SECRET, 1000);
    expect(verifyCollabToken(token, SECRET, { now: 1001 })).toEqual({
      ...claims,
      exp: 1000 + TOKEN_TTL_MS,
    });
  });
  it("expire after 60 seconds", () => {
    const token = signCollabToken(claims, SECRET, 1000);
    expect(verifyCollabToken(token, SECRET, { now: 1000 + TOKEN_TTL_MS - 1 })).not.toBeNull();
    expect(verifyCollabToken(token, SECRET, { now: 1000 + TOKEN_TTL_MS })).toBeNull();
  });
  it("fail with another secret, another note, or a changed payload", () => {
    const token = signCollabToken(claims, SECRET, 1000);
    expect(verifyCollabToken(token, "x".repeat(40), { now: 1001 })).toBeNull();
    expect(verifyCollabToken(token, SECRET, { now: 1001, noteId: "n2" })).toBeNull();
    const [payload, sig] = token.split(".");
    const forged = Buffer.from(
      JSON.stringify({ ...claims, role: "edit", userId: "u2", exp: 9e15 }),
    ).toString("base64url");
    expect(verifyCollabToken(`${forged}.${sig}`, SECRET)).toBeNull();
    expect(verifyCollabToken(`${payload}`, SECRET)).toBeNull();
    expect(verifyCollabToken("a.b.c", SECRET)).toBeNull();
    expect(verifyCollabToken("", SECRET)).toBeNull();
  });
  it("carry the read role", () => {
    const token = signCollabToken({ ...claims, role: "read" }, SECRET, 1);
    expect(verifyCollabToken(token, SECRET, { now: 2 })?.role).toBe("read");
  });
});

describe("presence", () => {
  it("colour is stable per user and initials are short", () => {
    expect(presenceColor("abc")).toBe(presenceColor("abc"));
    expect(presenceInitials("Olivia Owner")).toBe("OO");
    expect(presenceInitials("  gus ")).toBe("G");
    expect(presenceInitials("")).toBe("?");
  });
});
