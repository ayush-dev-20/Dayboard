import { describe, expect, it } from "vitest";
import {
  INVITATION_TTL_DAYS,
  hashInvitationToken,
  invitationExpiry,
  isOpen,
  newInvitationToken,
  normalizeInviteEmail,
} from "@/lib/sharing/invitations";

describe("invitation tokens", () => {
  it("are random, long, and hashed with a stable one-way hash", () => {
    const a = newInvitationToken();
    const b = newInvitationToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(40);
    expect(hashInvitationToken(a)).toBe(hashInvitationToken(a));
    expect(hashInvitationToken(a)).not.toContain(a);
    expect(hashInvitationToken(a)).not.toBe(hashInvitationToken(b));
  });
  it("normalise addresses", () => {
    expect(normalizeInviteEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("invitation expiry", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const base = { acceptedAt: null, declinedAt: null, revokedAt: null };
  it("lasts 14 days", () => {
    expect(INVITATION_TTL_DAYS).toBe(14);
    expect(invitationExpiry(now).toISOString()).toBe("2026-01-15T00:00:00.000Z");
  });
  it("is open until answered, revoked or expired", () => {
    const expiresAt = invitationExpiry(now);
    expect(isOpen({ ...base, expiresAt }, now)).toBe(true);
    expect(isOpen({ ...base, expiresAt }, new Date("2026-01-15T00:00:00Z"))).toBe(false);
    expect(isOpen({ ...base, acceptedAt: now, expiresAt }, now)).toBe(false);
    expect(isOpen({ ...base, declinedAt: now, expiresAt }, now)).toBe(false);
    expect(isOpen({ ...base, revokedAt: now, expiresAt }, now)).toBe(false);
  });
});
