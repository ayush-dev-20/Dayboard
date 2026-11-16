import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import type { Executor } from "@/db/executor";
import { attachments, notes, projects, tasks } from "@/db/schema";
import { env } from "@/lib/env";
import { toAttachmentDTO, type AttachmentDTO, type StorageUsage } from "@/lib/storage/dto";
import type { OwnerType } from "@/lib/storage/types";
import { resolveAccess } from "@/modules/permissions/access";

// Reads for files (V2 feature 09 §4). Every one is scoped to the signed-in person, and a file
// belongs to its note, task or project: a file whose owner is in Trash is hidden with it (and comes
// back when the owner is restored), so nothing needs to be written when an owner is trashed.

/** Whether the note, task or project exists, is the person's and is not in Trash. */
export async function ownerIsLive(
  executor: Executor,
  userId: string,
  ownerType: OwnerType,
  ownerId: string,
): Promise<boolean> {
  const table = ownerType === "NOTE" ? notes : ownerType === "TASK" ? tasks : projects;
  const [row] = await executor
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, ownerId), eq(table.userId, userId), isNull(table.deletedAt)))
    .limit(1);
  return row !== undefined;
}

/**
 * Whose files to read for this note, task or project: the person's own, or the owner's when a share lets the person read
 * it (V3 feature 04: a file is served by the access its holder has). Null when neither.
 */
async function holderFor(
  userId: string,
  ownerType: OwnerType,
  ownerId: string,
): Promise<string | null> {
  if (await ownerIsLive(db, userId, ownerType, ownerId)) return userId;
  const access = await resolveAccess(userId, ownerType, ownerId);
  return access.role !== null ? access.ownerId : null;
}

/** The person's files that are ready, newest first, for one owner. Empty when the owner is gone. */
export async function listAttachments(
  userId: string,
  ownerType: OwnerType,
  ownerId: string,
): Promise<AttachmentDTO[]> {
  const holderId = await holderFor(userId, ownerType, ownerId);
  if (!holderId) return [];
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        eq(attachments.userId, holderId),
        eq(attachments.ownerType, ownerType),
        eq(attachments.ownerId, ownerId),
        eq(attachments.status, "READY"),
        isNull(attachments.deletedAt),
      ),
    )
    .orderBy(desc(attachments.createdAt));
  return rows.map(toAttachmentDTO);
}

/** One ready file the person owns, on a live owner; null for anything else (never says which). */
export async function getReadyAttachment(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(attachments)
    .where(
      and(eq(attachments.id, id), eq(attachments.status, "READY"), isNull(attachments.deletedAt)),
    )
    .limit(1);
  if (!row) return null;
  // The holder's own file, or one on an item the person may read through a share; never says which case failed.
  if (row.userId === userId) {
    if (!(await ownerIsLive(db, userId, row.ownerType, row.ownerId))) return null;
    return row;
  }
  const holderId = await holderFor(userId, row.ownerType, row.ownerId);
  return holderId === row.userId ? row : null;
}

/** What several files are now, for blocks that point at them: missing ones are simply absent. */
export async function getAttachmentsByIds(
  userId: string,
  ids: readonly string[],
): Promise<AttachmentDTO[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(attachments)
    .where(
      and(
        inArray(attachments.id, [...ids]),
        eq(attachments.status, "READY"),
        isNull(attachments.deletedAt),
      ),
    );
  // A file whose owner is in Trash is hidden along with it, as on download.
  const live = await Promise.all(
    rows.map(async (row) =>
      row.userId === userId
        ? ownerIsLive(db, userId, row.ownerType, row.ownerId)
        : (await holderFor(userId, row.ownerType, row.ownerId)) === row.userId,
    ),
  );
  return rows.filter((_, index) => live[index]).map(toAttachmentDTO);
}

/** Bytes in use (ready and pending files) by one person, or by everyone when no person is given. */
export async function usedBytes(executor: Executor, userId?: string): Promise<number> {
  const [row] = await executor
    .select({ n: sql<number>`coalesce(sum(${attachments.sizeBytes}), 0)::float8` })
    .from(attachments)
    .where(
      and(
        inArray(attachments.status, ["READY", "PENDING"]),
        userId ? eq(attachments.userId, userId) : undefined,
      ),
    );
  return Number(row?.n ?? 0);
}

/** For Settings: how much of the person's allowance is used. */
export async function storageUsage(userId: string): Promise<StorageUsage> {
  if (!env.storageAvailable) return { available: false, usedBytes: 0, quotaBytes: 0 };
  return {
    available: true,
    usedBytes: await usedBytes(db, userId),
    quotaBytes: env.storageQuotaBytes,
  };
}
