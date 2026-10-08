import "server-only";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { attachments, type Attachment } from "@/db/schema";
import { ownerIsLive, usedBytes } from "@/db/queries/attachments";
import { env } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { uuidv7 } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { toAttachmentDTO, type AttachmentDTO, type IntentResult } from "@/lib/storage/dto";
import { getStorage } from "@/lib/storage";
import { createStorageKey } from "@/lib/storage/keys";
import { sanitizeFileName } from "@/lib/storage/names";
import { categoryOf, limitFor, validateDeclared } from "@/lib/storage/policy";
import { checkLimits } from "@/lib/storage/quota";
import { SNIFF_BYTES, sniffMatches } from "@/lib/storage/sniff";
import { STORAGE_SETTINGS, type OwnerType } from "@/lib/storage/types";

// Everything that creates, confirms or removes a file (V2 feature 09 §4). The bytes never pass
// through here: the browser uploads straight to storage, and `finalize` looks at what arrived.

/** Intents a person may start in one minute. */
export const INTENTS_PER_MINUTE = 30;
/** A file that never finalized is removed after this long. */
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
/** A deleted file's object is removed after this long. */
export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function requireStorage() {
  const storage = getStorage();
  // With no storage configured the feature is off: the routes look like they do not exist.
  if (!storage) throw new AppError("NOT_FOUND");
  return storage;
}

export type IntentInput = {
  /** A suggested id; used only when nothing has it (see below). */
  id?: string;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
};

/**
 * Starts an upload: checks the file and the person's allowance, writes a `PENDING` row and returns a
 * short-lived URL for the browser to PUT to. A client may suggest the id (so a retry reuses it); it
 * is used only when it is free or is the same person's unfinished upload of the same file. An id
 * that someone else has is replaced by a new one without saying so, so this can never be used to
 * find out whether another person's id exists.
 */
export async function createIntent(userId: string, input: IntentInput): Promise<IntentResult> {
  const storage = requireStorage();

  const checked = validateDeclared({ name: input.name, mime: input.mime, size: input.size });
  if (!checked.ok) {
    throw new AppError(
      checked.code === "FILE_TOO_LARGE" ? "FILE_TOO_LARGE" : "UNSUPPORTED_FILE_TYPE",
      checked.message,
    );
  }
  if (!(await ownerIsLive(db, userId, input.ownerType, input.ownerId))) {
    throw new AppError("NOT_FOUND");
  }

  // A person's own stale uploads are cleared first, so they never count against them.
  await cleanupPendingFor(userId).catch((error) =>
    logger.warn("pending cleanup failed", { error }),
  );

  return db.transaction(async (tx) => {
    // One lock for everyone: the whole-service limit is a sum, and two intents racing past it would
    // both succeed. Intents are short and rare, so serialising them costs nothing.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('storage-intents', 9))`);

    const [recent] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(attachments)
      .where(
        and(
          eq(attachments.userId, userId),
          sql`${attachments.createdAt} > now() - interval '1 minute'`,
        ),
      );
    if ((recent?.n ?? 0) >= INTENTS_PER_MINUTE) {
      throw new AppError("RATE_LIMITED", "Too many uploads at once. Try again in a moment.", {
        retryAfterSeconds: 60,
      });
    }

    const verdict = checkLimits({
      personBytes: await usedBytes(tx, userId),
      totalBytes: await usedBytes(tx),
      addingBytes: input.size,
      personLimitBytes: env.storageQuotaBytes,
      totalLimitBytes: env.storageTotalLimitBytes,
    });
    if (!verdict.ok) throw new AppError(verdict.code, verdict.message);

    const name = sanitizeFileName(input.name);
    const now = new Date();

    // A retry of the person's own unfinished upload of the same file keeps its id and key.
    let existing: Attachment | undefined;
    if (input.id) {
      [existing] = await tx
        .select()
        .from(attachments)
        .where(and(eq(attachments.id, input.id), eq(attachments.userId, userId)))
        .limit(1);
    }
    const retry =
      existing &&
      existing.status === "PENDING" &&
      existing.ownerType === input.ownerType &&
      existing.ownerId === input.ownerId
        ? existing
        : undefined;

    let id: string;
    let key: string;
    if (retry) {
      id = retry.id;
      key = retry.storageKey;
      await tx
        .update(attachments)
        .set({
          originalName: name,
          mimeType: checked.mime,
          sizeBytes: input.size,
          width: input.width ?? null,
          height: input.height ?? null,
        })
        .where(eq(attachments.id, id));
    } else {
      // The suggested id is used only if nobody has it, in any state, for anyone.
      let free = false;
      if (input.id) {
        const [taken] = await tx
          .select({ id: attachments.id })
          .from(attachments)
          .where(eq(attachments.id, input.id))
          .limit(1);
        free = taken === undefined;
      }
      id = free && input.id ? input.id : uuidv7();
      key = createStorageKey(userId, id, now);
      await tx.insert(attachments).values({
        id,
        userId,
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        storageKey: key,
        originalName: name,
        mimeType: checked.mime,
        sizeBytes: input.size,
        width: input.width ?? null,
        height: input.height ?? null,
        status: "PENDING",
      });
    }

    const upload = await storage.createUploadUrl(key, {
      mime: checked.mime,
      size: input.size,
      expiresIn: STORAGE_SETTINGS.uploadExpiresIn,
    });
    return {
      attachmentId: id,
      upload,
      expiresAt: new Date(now.getTime() + STORAGE_SETTINGS.uploadExpiresIn * 1000).toISOString(),
    };
  });
}

async function reject(row: Attachment, reason: string): Promise<never> {
  const storage = getStorage();
  // The object is useless and may be harmful: remove it now.
  await storage?.delete(row.storageKey).catch((error) => logger.warn("delete failed", { error }));
  await db
    .update(attachments)
    .set({ status: "REJECTED", rejectReason: reason, deletedAt: new Date() })
    .where(eq(attachments.id, row.id));
  throw new AppError(
    reason === "SIZE_MISMATCH" || reason === "TOO_LARGE"
      ? "FILE_TOO_LARGE"
      : "UNSUPPORTED_FILE_TYPE",
    reason === "SIZE_MISMATCH" || reason === "TOO_LARGE"
      ? "That file was larger than it said it was."
      : "This file isn't what its type says it is, so it was not accepted.",
  );
}

/**
 * Confirms an upload: the object must exist with the size that was declared, and its first bytes must
 * agree with the type it was accepted as. Anything else is rejected and the object removed. Safe to
 * call again: a file that is already ready just comes back.
 */
export async function finalizeAttachment(userId: string, id: string): Promise<AttachmentDTO> {
  const storage = requireStorage();
  const [row] = await db
    .select()
    .from(attachments)
    .where(and(eq(attachments.id, id), eq(attachments.userId, userId)))
    .limit(1);
  if (!row || row.status === "DELETED") throw new AppError("NOT_FOUND");
  if (row.status === "READY") return toAttachmentDTO(row);
  if (row.status === "REJECTED") {
    throw new AppError("UNSUPPORTED_FILE_TYPE", "This file was not accepted.");
  }

  const head = await storage.head(row.storageKey);
  if (!head) {
    throw new AppError("VALIDATION_ERROR", "The upload didn't arrive. Try again.");
  }
  const category = categoryOf(row.mimeType);
  if (!category || head.size > limitFor(category)) return reject(row, "TOO_LARGE");
  if (head.size !== row.sizeBytes) return reject(row, "SIZE_MISMATCH");

  const bytes = await storage.readHead(row.storageKey, Math.min(SNIFF_BYTES, head.size));
  const sniffed = sniffMatches(bytes, row.mimeType);
  if (!sniffed.ok) return reject(row, sniffed.reason);

  const [ready] = await db
    .update(attachments)
    .set({ status: "READY", finalizedAt: new Date() })
    .where(and(eq(attachments.id, id), eq(attachments.status, "PENDING")))
    .returning();
  // Two finalizes at once: the second finds it already done.
  if (!ready) {
    const [again] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    if (again?.status === "READY") return toAttachmentDTO(again);
    throw new AppError("CONFLICT");
  }
  return toAttachmentDTO(ready);
}

/** Soft delete: hidden at once, and the object is removed after the retention period. */
export async function deleteAttachment(userId: string, id: string): Promise<void> {
  const [row] = await db
    .update(attachments)
    .set({ status: "DELETED", deletedAt: new Date() })
    .where(
      and(
        eq(attachments.id, id),
        eq(attachments.userId, userId),
        inArray(attachments.status, ["READY", "PENDING"]),
      ),
    )
    .returning({ id: attachments.id });
  if (!row) throw new AppError("NOT_FOUND");
}

// ---- Housekeeping (the jobs of V2 feature 08 §8, until that feature exists) --------------------
// The spec runs these as background jobs. There is no job runner yet, so each is a plain function a
// job handler can call later, and the ones that work on one person's files also run for that person
// when they upload, so abandoned uploads and old deleted files do not pile up unseen.

async function removeObjects(rows: { id: string; storageKey: string }[]): Promise<number> {
  const storage = getStorage();
  if (!storage || rows.length === 0) return 0;
  const done: string[] = [];
  for (const row of rows) {
    try {
      await storage.delete(row.storageKey);
      done.push(row.id);
    } catch (error) {
      // Kept for the next pass: never drop a row whose object may still exist.
      logger.warn("could not delete a stored file", { attachmentId: row.id, error });
    }
  }
  if (done.length > 0) await db.delete(attachments).where(inArray(attachments.id, done));
  return done.length;
}

/** `attachment.cleanup_pending`: uploads that never finalized, older than a day, and their objects. */
export async function cleanupPending(userId?: string): Promise<number> {
  const rows = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        eq(attachments.status, "PENDING"),
        lt(attachments.createdAt, new Date(Date.now() - PENDING_TTL_MS)),
        userId ? eq(attachments.userId, userId) : undefined,
      ),
    )
    .limit(200);
  return removeObjects(rows);
}
const cleanupPendingFor = (userId: string) => cleanupPending(userId);

/**
 * `attachment.purge`: objects of files deleted more than 30 days ago, of rejected files, and of
 * files whose note, task or project was deleted for good.
 */
export async function purgeExpired(userId?: string): Promise<number> {
  const orphan = or(
    sql`(${attachments.ownerType} = 'NOTE' and not exists (select 1 from notes n where n.id = ${attachments.ownerId}))`,
    sql`(${attachments.ownerType} = 'TASK' and not exists (select 1 from tasks t where t.id = ${attachments.ownerId}))`,
    sql`(${attachments.ownerType} = 'PROJECT' and not exists (select 1 from projects p where p.id = ${attachments.ownerId}))`,
  );
  const rows = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(
      and(
        userId ? eq(attachments.userId, userId) : undefined,
        or(
          and(
            inArray(attachments.status, ["DELETED", "REJECTED"]),
            lt(attachments.deletedAt, new Date(Date.now() - RETENTION_MS)),
          ),
          // A rejected file's object is already gone: only the row is left.
          and(eq(attachments.status, "REJECTED"), isNull(attachments.deletedAt)),
          orphan,
        ),
      ),
    )
    .limit(200);
  return removeObjects(rows);
}
