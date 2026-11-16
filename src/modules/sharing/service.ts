import "server-only";
import { and, count, desc, eq, gt, ilike, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, invitations, notes, projects, resourceGrants, tasks, user } from "@/db/schema";
import { getEmailSender, shareInvitationMessage } from "@/lib/email";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { logger } from "@/lib/logger";
import {
  INVITES_PER_ADDRESS_PER_DAY,
  INVITES_PER_PERSON_PER_DAY,
  KIND_LABEL,
  ROLE_LABEL,
  hashInvitationToken,
  invitationExpiry,
  isOpen,
  newInvitationToken,
  normalizeInviteEmail,
} from "@/lib/sharing/invitations";
import { accessibleWhere } from "@/modules/permissions/access";
import { requireOwner } from "@/modules/permissions/acting";
import type { GrantRole } from "@/modules/permissions/types";

// Sharing, from the owner's side and the invitee's (V3 feature 04 §5, docs/decisions/0018). Everything here holds ids,
// roles and counts: no titles or text reach an email or a log. An invitation answers the same whether or not the address
// has an account.

export type ShareType = "PROJECT" | "NOTE";

const DAY = 24 * 60 * 60 * 1000;

type Refs = { type: string; id: string }[];

/**
 * One audit row per sharing event (V3 feature 04 §7, source `SHARING`): who did what, to which item, in counts and ids
 * only. No title, text or email address ever goes in `summary` or `entityRefs`.
 */
async function audit(
  actorId: string,
  action: string,
  refs: Refs,
  summary: string,
  executor: Pick<typeof db, "insert"> = db,
) {
  await executor.insert(auditLog).values({
    userId: actorId,
    source: "SHARING",
    action,
    entityRefs: refs,
    proposalId: `share:${uuidv7()}`,
    summary,
  });
}

const resourceRef = (type: string, id: string) => ({ type: type.toLowerCase(), id });

/** Sharing is staged behind a flag: with it off the feature does not exist. */
export function assertSharingOn() {
  if (!env.sharingEnabled) throw new AppError("NOT_FOUND");
}

async function assertShareable(type: ShareType, id: string) {
  if (type === "PROJECT") {
    const [row] = await db
      .select({ deletedAt: projects.deletedAt })
      .from(projects)
      .where(eq(projects.id, id));
    if (!row || row.deletedAt) throw new AppError("NOT_FOUND");
    return;
  }
  const [row] = await db
    .select({ deletedAt: notes.deletedAt, journalDate: notes.journalDate })
    .from(notes)
    .where(eq(notes.id, id));
  if (!row || row.deletedAt) throw new AppError("NOT_FOUND");
  if (row.journalDate)
    throw new AppError("VALIDATION_ERROR", "Journal entries are private and cannot be shared.");
}

export type InviteResult = { id: string; email: string; role: GrantRole; expiresAt: string };

export async function inviteToShare(
  actorId: string,
  input: { type: ShareType; id: string; email: string; role: GrantRole },
  now = new Date(),
): Promise<InviteResult> {
  assertSharingOn();
  await requireOwner(actorId, input.type, input.id);
  await assertShareable(input.type, input.id);
  const email = normalizeInviteEmail(input.email);

  const [me] = await db
    .select({ name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, actorId));
  if (!me) throw new AppError("UNAUTHENTICATED");
  if (me.email.toLowerCase() === email)
    throw new AppError("VALIDATION_ERROR", "That's you: you already own this.", {
      fieldErrors: { email: "That's you." },
    });

  // Already has access? Only the owner can ask, and the owner can already see who has access.
  const [existing] = await db
    .select({ id: resourceGrants.id })
    .from(resourceGrants)
    .innerJoin(user, eq(user.id, resourceGrants.granteeId))
    .where(
      and(
        eq(resourceGrants.resourceType, input.type),
        eq(resourceGrants.resourceId, input.id),
        sql`lower(${user.email}) = ${email}`,
      ),
    );
  if (existing)
    throw new AppError("VALIDATION_ERROR", "This person already has access.", {
      fieldErrors: { email: "This person already has access." },
    });

  const since = new Date(now.getTime() - DAY);
  const [[byPerson], [byAddress]] = await Promise.all([
    db
      .select({ n: count() })
      .from(invitations)
      .where(and(eq(invitations.ownerId, actorId), gt(invitations.createdAt, since))),
    db
      .select({ n: count() })
      .from(invitations)
      .where(and(eq(invitations.inviteeEmail, email), gt(invitations.createdAt, since))),
  ]);
  if ((byPerson?.n ?? 0) >= INVITES_PER_PERSON_PER_DAY)
    throw new AppError(
      "RATE_LIMITED",
      "You've sent a lot of invitations today. Try again tomorrow.",
    );
  // The same wording as any other answer: the sender learns nothing about the address.
  if ((byAddress?.n ?? 0) >= INVITES_PER_ADDRESS_PER_DAY)
    throw new AppError(
      "RATE_LIMITED",
      "Too many invitations to this address today. Try again tomorrow.",
    );

  const token = newInvitationToken();
  const created = await db.transaction(async (tx) => {
    // Inviting again replaces the open invitation: a new link, the new role.
    await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invitations.resourceType, input.type),
          eq(invitations.resourceId, input.id),
          eq(invitations.inviteeEmail, email),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
        ),
      );
    const [row] = await tx
      .insert(invitations)
      .values({
        resourceType: input.type,
        resourceId: input.id,
        ownerId: actorId,
        inviteeEmail: email,
        role: input.role,
        tokenHash: hashInvitationToken(token),
        expiresAt: invitationExpiry(now),
      })
      .returning();
    if (!row) throw new AppError("INTERNAL_ERROR");
    return row;
  });

  await audit(
    actorId,
    "share.invite",
    [resourceRef(input.type, input.id), { type: "invitation", id: created.id }],
    `Invited 1 person as ${input.role.toLowerCase()}.`,
  );
  try {
    await getEmailSender().send(
      shareInvitationMessage({
        to: email,
        ownerName: me.name,
        kind: KIND_LABEL[input.type],
        role: ROLE_LABEL[input.role],
        url: `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/share/accept?token=${token}`,
      }),
    );
  } catch (error) {
    // The invitation stands and shows in the dialog; the owner can invite again.
    logger.warn("share invitation email failed", {
      invitationId: created.id,
      error: error instanceof Error ? error.message : "unknown",
    });
  }
  return {
    id: created.id,
    email,
    role: input.role,
    expiresAt: created.expiresAt.toISOString(),
  };
}

export type ShareList = {
  grants: { id: string; name: string; email: string; role: GrantRole }[];
  invitations: { id: string; email: string; role: GrantRole; expiresAt: string }[];
};

export async function listShares(
  actorId: string,
  input: { type: ShareType; id: string },
  now = new Date(),
): Promise<ShareList> {
  assertSharingOn();
  await requireOwner(actorId, input.type, input.id);
  const [grantRows, inviteRows] = await Promise.all([
    db
      .select({
        id: resourceGrants.id,
        name: user.name,
        email: user.email,
        role: resourceGrants.role,
      })
      .from(resourceGrants)
      .innerJoin(user, eq(user.id, resourceGrants.granteeId))
      .where(
        and(
          eq(resourceGrants.resourceType, input.type),
          eq(resourceGrants.resourceId, input.id),
          eq(resourceGrants.ownerId, actorId),
        ),
      )
      .orderBy(resourceGrants.createdAt),
    db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.resourceType, input.type),
          eq(invitations.resourceId, input.id),
          eq(invitations.ownerId, actorId),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .orderBy(desc(invitations.createdAt)),
  ]);
  return {
    grants: grantRows.map((g) => ({ ...g, role: g.role as GrantRole })),
    invitations: inviteRows.map((i) => ({
      id: i.id,
      email: i.inviteeEmail,
      role: i.role as GrantRole,
      expiresAt: i.expiresAt.toISOString(),
    })),
  };
}

async function ownedGrant(actorId: string, grantId: string) {
  const [grant] = await db
    .select()
    .from(resourceGrants)
    .where(and(eq(resourceGrants.id, grantId), eq(resourceGrants.ownerId, actorId)));
  if (!grant) throw new AppError("NOT_FOUND");
  return grant;
}

export async function changeShareRole(
  actorId: string,
  input: { grantId: string; role: GrantRole },
) {
  assertSharingOn();
  const grant = await ownedGrant(actorId, input.grantId);
  await db.update(resourceGrants).set({ role: input.role }).where(eq(resourceGrants.id, grant.id));
  await audit(
    actorId,
    "share.changeRole",
    [resourceRef(grant.resourceType, grant.resourceId), { type: "grant", id: grant.id }],
    `Changed 1 person's role to ${input.role.toLowerCase()}.`,
  );
}

export async function removeShare(actorId: string, grantId: string) {
  assertSharingOn();
  const grant = await ownedGrant(actorId, grantId);
  await db.delete(resourceGrants).where(eq(resourceGrants.id, grant.id));
  await audit(
    actorId,
    "share.remove",
    [resourceRef(grant.resourceType, grant.resourceId), { type: "grant", id: grant.id }],
    "Removed 1 person's access.",
  );
}

/** Stops sharing an item: removes every grant on it and withdraws every open invitation. Owner only. */
export async function revokeAllShares(
  actorId: string,
  input: { type: ShareType; id: string },
  now = new Date(),
): Promise<{ removed: number; withdrawn: number }> {
  assertSharingOn();
  await requireOwner(actorId, input.type, input.id);
  return db.transaction(async (tx) => {
    const removed = await tx
      .delete(resourceGrants)
      .where(
        and(
          eq(resourceGrants.resourceType, input.type),
          eq(resourceGrants.resourceId, input.id),
          eq(resourceGrants.ownerId, actorId),
        ),
      )
      .returning({ id: resourceGrants.id });
    const withdrawn = await tx
      .update(invitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(invitations.resourceType, input.type),
          eq(invitations.resourceId, input.id),
          eq(invitations.ownerId, actorId),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning({ id: invitations.id });
    await audit(
      actorId,
      "share.revokeAll",
      [resourceRef(input.type, input.id)],
      `Stopped sharing: removed ${removed.length} people, withdrew ${withdrawn.length} invitations.`,
      tx,
    );
    return { removed: removed.length, withdrawn: withdrawn.length };
  });
}

export async function leaveShare(actorId: string, grantId: string) {
  assertSharingOn();
  const [grant] = await db
    .select({ id: resourceGrants.id })
    .from(resourceGrants)
    .where(and(eq(resourceGrants.id, grantId), eq(resourceGrants.granteeId, actorId)));
  if (!grant) throw new AppError("NOT_FOUND");
  await db.delete(resourceGrants).where(eq(resourceGrants.id, grant.id));
  await audit(actorId, "share.leave", [{ type: "grant", id: grant.id }], "Left 1 shared item.");
}

export async function revokeInvitation(actorId: string, id: string, now = new Date()) {
  assertSharingOn();
  const [row] = await db
    .update(invitations)
    .set({ revokedAt: now })
    .where(
      and(
        eq(invitations.id, id),
        eq(invitations.ownerId, actorId),
        isNull(invitations.acceptedAt),
        isNull(invitations.declinedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning({ id: invitations.id });
  if (!row) throw new AppError("NOT_FOUND");
  await audit(
    actorId,
    "share.revokeInvitation",
    [{ type: "invitation", id: row.id }],
    "Withdrew 1 invitation.",
  );
}

// --- the invitee -----------------------------------------------------------------------------------------------------

type AnswerInput = { token: string } | { id: string };

/** The open invitation this person may answer: addressed to their verified email, not expired, not revoked. */
async function invitationFor(actorId: string, input: AnswerInput, now: Date) {
  const [me] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, actorId));
  if (!me || !me.verified) throw new AppError("NOT_FOUND");
  const where =
    "token" in input
      ? eq(invitations.tokenHash, hashInvitationToken(input.token))
      : eq(invitations.id, input.id);
  const [row] = await db
    .select()
    .from(invitations)
    .where(and(where, eq(invitations.inviteeEmail, me.email.toLowerCase())));
  // A token for another address, an old one, a revoked one and a made-up one all look the same.
  if (!row || !isOpen(row, now) || row.ownerId === actorId) throw new AppError("NOT_FOUND");
  return row;
}

export async function acceptInvitation(
  actorId: string,
  input: AnswerInput,
  now = new Date(),
): Promise<{ type: ShareType; id: string }> {
  assertSharingOn();
  const invitation = await invitationFor(actorId, input, now);
  const type = invitation.resourceType as ShareType;
  await db.transaction(async (tx) => {
    // The item must still be the inviter's, and live.
    const [item] =
      type === "PROJECT"
        ? await tx
            .select({
              ownerId: projects.userId,
              deletedAt: projects.deletedAt,
              journal: sql<null>`null`,
            })
            .from(projects)
            .where(eq(projects.id, invitation.resourceId))
        : await tx
            .select({
              ownerId: notes.userId,
              deletedAt: notes.deletedAt,
              journal: notes.journalDate,
            })
            .from(notes)
            .where(eq(notes.id, invitation.resourceId));
    if (!item || item.deletedAt || item.journal || item.ownerId !== invitation.ownerId)
      throw new AppError("NOT_FOUND");
    await tx
      .insert(resourceGrants)
      .values({
        resourceType: type,
        resourceId: invitation.resourceId,
        ownerId: invitation.ownerId,
        granteeId: actorId,
        role: invitation.role,
        createdBy: invitation.ownerId,
      })
      .onConflictDoUpdate({
        target: [resourceGrants.resourceType, resourceGrants.resourceId, resourceGrants.granteeId],
        set: { role: invitation.role },
      });
    await tx
      .update(invitations)
      .set({ acceptedAt: now })
      .where(and(eq(invitations.id, invitation.id), isNull(invitations.acceptedAt)));
    await audit(
      actorId,
      "share.accept",
      [resourceRef(type, invitation.resourceId), { type: "invitation", id: invitation.id }],
      `Accepted 1 invitation as ${invitation.role.toLowerCase()}.`,
      tx,
    );
  });
  return { type, id: invitation.resourceId };
}

export async function declineInvitation(actorId: string, input: AnswerInput, now = new Date()) {
  assertSharingOn();
  const invitation = await invitationFor(actorId, input, now);
  await db.update(invitations).set({ declinedAt: now }).where(eq(invitations.id, invitation.id));
  await audit(
    actorId,
    "share.decline",
    [{ type: "invitation", id: invitation.id }],
    "Declined 1 invitation.",
  );
}

// --- Shared with me --------------------------------------------------------------------------------------------------

export type SharedItem = {
  grantId: string;
  type: ShareType;
  id: string;
  title: string;
  emoji: string | null;
  role: GrantRole;
  ownerName: string;
};
export type PendingInvitation = {
  id: string;
  type: ShareType;
  role: GrantRole;
  ownerName: string;
  expiresAt: string;
};
export type SharedWithMe = { items: SharedItem[]; invitations: PendingInvitation[] };

export async function listSharedWithMe(actorId: string, now = new Date()): Promise<SharedWithMe> {
  if (!env.sharingEnabled) return { items: [], invitations: [] };
  const [grantRows, [me]] = await Promise.all([
    db
      .select()
      .from(resourceGrants)
      .where(eq(resourceGrants.granteeId, actorId))
      .orderBy(desc(resourceGrants.createdAt)),
    db
      .select({ email: user.email, verified: user.emailVerified })
      .from(user)
      .where(eq(user.id, actorId)),
  ]);

  const projectIds = grantRows.filter((g) => g.resourceType === "PROJECT").map((g) => g.resourceId);
  const noteIds = grantRows.filter((g) => g.resourceType === "NOTE").map((g) => g.resourceId);
  const [projectRows, noteRows, ownerRows] = await Promise.all([
    projectIds.length
      ? db
          .select({
            id: projects.id,
            ownerId: projects.userId,
            title: projects.name,
            emoji: sql<string | null>`null`,
            deletedAt: projects.deletedAt,
          })
          .from(projects)
          .where(inArray(projects.id, projectIds))
      : [],
    noteIds.length
      ? db
          .select({
            id: notes.id,
            ownerId: notes.userId,
            title: notes.title,
            emoji: notes.emoji,
            deletedAt: notes.deletedAt,
            journal: notes.journalDate,
          })
          .from(notes)
          .where(inArray(notes.id, noteIds))
      : [],
    grantRows.length
      ? db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, [...new Set(grantRows.map((g) => g.ownerId))]))
      : [],
  ]);
  const names = new Map(ownerRows.map((o) => [o.id, o.name]));
  const projectById = new Map(projectRows.map((p) => [p.id, p]));
  const noteById = new Map(noteRows.map((n) => [n.id, n]));

  const items: SharedItem[] = [];
  for (const g of grantRows) {
    const row =
      g.resourceType === "PROJECT" ? projectById.get(g.resourceId) : noteById.get(g.resourceId);
    // A grant counts only while the item is live and still the granter's.
    if (!row || row.deletedAt || row.ownerId !== g.ownerId) continue;
    if ("journal" in row && row.journal) continue;
    items.push({
      grantId: g.id,
      type: g.resourceType as ShareType,
      id: g.resourceId,
      title: row.title,
      emoji: row.emoji ?? null,
      role: g.role as GrantRole,
      ownerName: names.get(g.ownerId) ?? "Former member",
    });
  }

  let pending: PendingInvitation[] = [];
  if (me?.verified) {
    const rows = await db
      .select({
        id: invitations.id,
        type: invitations.resourceType,
        role: invitations.role,
        ownerName: user.name,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(user, eq(user.id, invitations.ownerId))
      .where(
        and(
          eq(invitations.inviteeEmail, me.email.toLowerCase()),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .orderBy(desc(invitations.createdAt));
    // Kind and owner only, until the person accepts: the same as the email.
    pending = rows.map((r) => ({
      id: r.id,
      type: r.type as ShareType,
      role: r.role as GrantRole,
      ownerName: r.ownerName,
      expiresAt: r.expiresAt.toISOString(),
    }));
  }
  return { items, invitations: pending };
}

/** The name shown next to a shared item. */
export async function ownerNameOf(ownerId: string): Promise<string> {
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, ownerId));
  return row?.name ?? "Former member";
}

/** What a page needs to show the markers and the Share button for one item. */
export async function shareContext(
  actorId: string,
  access: { ownerId: string; role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" },
  type: ShareType,
  id: string,
) {
  const [ownerName, shared] = await Promise.all([
    access.role === "OWNER" ? Promise.resolve("You") : ownerNameOf(access.ownerId),
    access.role === "OWNER"
      ? db
          .select({ id: resourceGrants.id })
          .from(resourceGrants)
          .where(
            and(
              eq(resourceGrants.resourceType, type),
              eq(resourceGrants.resourceId, id),
              eq(resourceGrants.ownerId, actorId),
            ),
          )
          .limit(1)
      : Promise.resolve([]),
  ]);
  return {
    role: access.role,
    ownerName,
    shareable: env.sharingEnabled && access.role === "OWNER",
    sharedWithOthers: shared.length > 0,
  };
}

export type SharedHit = {
  kind: "project" | "note" | "task";
  id: string;
  title: string;
  ownerName: string;
  /** Where to open it: a task opens in its project. */
  href: string;
};

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Title search over what other people shared with this person: projects, notes (and the notes under them) and the tasks of
 * shared projects. Rows come from `accessibleWhere`, so nothing outside a grant is ever selected; each hit says whose it is.
 */
export async function searchSharedWithMe(
  actorId: string,
  query: string,
  limit = 30,
): Promise<SharedHit[]> {
  if (!env.sharingEnabled) return [];
  const needle = query.trim();
  if (needle.length < 2) return [];
  const like = `%${escapeLike(needle)}%`;
  const [projectRows, noteRows, taskRows] = await Promise.all([
    db
      .select({ id: projects.id, title: projects.name, ownerId: projects.userId })
      .from(projects)
      .where(
        and(
          accessibleWhere(actorId, "PROJECT"),
          ne(projects.userId, actorId),
          ilike(projects.name, like),
        ),
      )
      .limit(limit),
    db
      .select({ id: notes.id, title: notes.title, ownerId: notes.userId })
      .from(notes)
      .where(
        and(accessibleWhere(actorId, "NOTE"), ne(notes.userId, actorId), ilike(notes.title, like)),
      )
      .limit(limit),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        ownerId: tasks.userId,
        projectId: tasks.projectId,
      })
      .from(tasks)
      .where(
        and(accessibleWhere(actorId, "TASK"), ne(tasks.userId, actorId), ilike(tasks.title, like)),
      )
      .limit(limit),
  ]);
  const ownerIds = [...new Set([...projectRows, ...noteRows, ...taskRows].map((r) => r.ownerId))];
  const owners = ownerIds.length
    ? await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ownerIds))
    : [];
  const name = new Map(owners.map((o) => [o.id, o.name]));
  const who = (id: string) => name.get(id) ?? "Former member";
  return [
    ...projectRows.map((r) => ({
      kind: "project" as const,
      id: r.id,
      title: r.title,
      ownerName: who(r.ownerId),
      href: `/projects/${r.id}`,
    })),
    ...noteRows.map((r) => ({
      kind: "note" as const,
      id: r.id,
      title: r.title || "Untitled",
      ownerName: who(r.ownerId),
      href: `/notes/${r.id}`,
    })),
    ...taskRows
      .filter((r) => r.projectId)
      .map((r) => ({
        kind: "task" as const,
        id: r.id,
        title: r.title,
        ownerName: who(r.ownerId),
        href: `/projects/${r.projectId}`,
      })),
  ].slice(0, limit);
}

export type SharedByMeItem = {
  type: ShareType;
  id: string;
  title: string;
  emoji: string | null;
  people: number;
  invitations: number;
};

/** What the person shares with others: each shared project or note with how many people and open invitations. */
export async function listSharedByMe(actorId: string, now = new Date()): Promise<SharedByMeItem[]> {
  if (!env.sharingEnabled) return [];
  const [grantRows, inviteRows] = await Promise.all([
    db
      .select({
        type: resourceGrants.resourceType,
        id: resourceGrants.resourceId,
        n: count(),
      })
      .from(resourceGrants)
      .where(eq(resourceGrants.ownerId, actorId))
      .groupBy(resourceGrants.resourceType, resourceGrants.resourceId),
    db
      .select({ type: invitations.resourceType, id: invitations.resourceId, n: count() })
      .from(invitations)
      .where(
        and(
          eq(invitations.ownerId, actorId),
          isNull(invitations.acceptedAt),
          isNull(invitations.declinedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, now),
        ),
      )
      .groupBy(invitations.resourceType, invitations.resourceId),
  ]);
  const keys = new Map<
    string,
    { type: ShareType; id: string; people: number; invitations: number }
  >();
  for (const g of grantRows)
    keys.set(`${g.type}:${g.id}`, {
      type: g.type as ShareType,
      id: g.id,
      people: g.n,
      invitations: 0,
    });
  for (const i of inviteRows) {
    const k = `${i.type}:${i.id}`;
    const e = keys.get(k) ?? { type: i.type as ShareType, id: i.id, people: 0, invitations: 0 };
    e.invitations = i.n;
    keys.set(k, e);
  }
  const all = [...keys.values()];
  const projectIds = all.filter((e) => e.type === "PROJECT").map((e) => e.id);
  const noteIds = all.filter((e) => e.type === "NOTE").map((e) => e.id);
  const [projectRows, noteRows] = await Promise.all([
    projectIds.length
      ? db
          .select({ id: projects.id, title: projects.name })
          .from(projects)
          .where(
            and(
              inArray(projects.id, projectIds),
              eq(projects.userId, actorId),
              isNull(projects.deletedAt),
            ),
          )
      : [],
    noteIds.length
      ? db
          .select({ id: notes.id, title: notes.title, emoji: notes.emoji })
          .from(notes)
          .where(
            and(inArray(notes.id, noteIds), eq(notes.userId, actorId), isNull(notes.deletedAt)),
          )
      : [],
  ]);
  const titles = new Map<string, { title: string; emoji: string | null }>([
    ...projectRows.map((p) => [`PROJECT:${p.id}`, { title: p.title, emoji: null }] as const),
    ...noteRows.map((n) => [`NOTE:${n.id}`, { title: n.title, emoji: n.emoji ?? null }] as const),
  ]);
  return all
    .filter((e) => titles.has(`${e.type}:${e.id}`))
    .map((e) => ({ ...e, ...titles.get(`${e.type}:${e.id}`)! }));
}
