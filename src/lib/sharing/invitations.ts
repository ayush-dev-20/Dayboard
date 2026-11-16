import { createHash, randomBytes } from "node:crypto";

// Invitation rules that need no database (V3 feature 04 §5, docs/decisions/0018).

export const INVITATION_TTL_DAYS = 14;
/** Invitations one person may send in a day, and one address may receive in a day (from anyone). */
export const INVITES_PER_PERSON_PER_DAY = 20;
export const INVITES_PER_ADDRESS_PER_DAY = 5;

/** A random token for the email link. Shown once; only its hash is stored. */
export function newInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const normalizeInviteEmail = (email: string) => email.trim().toLowerCase();

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export type InvitationState = {
  acceptedAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
};

/** Open means it can still be accepted: not answered, not revoked, not expired. */
export function isOpen(invitation: InvitationState, now: Date): boolean {
  return (
    !invitation.acceptedAt &&
    !invitation.declinedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt.getTime() > now.getTime()
  );
}

export const KIND_LABEL = { PROJECT: "project", NOTE: "note" } as const;
export const ROLE_LABEL = { EDITOR: "Editor", COMMENTER: "Commenter", VIEWER: "Viewer" } as const;
export const ROLE_HELP = {
  EDITOR: "Can add and change things, but cannot share or delete for good.",
  COMMENTER: "Can read and comment.",
  VIEWER: "Can read only.",
} as const;
