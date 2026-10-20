import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { pushSubscriptions } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

// Push subscriptions (V2 feature 14 §2, §6, §7). Every read and write here takes the person from the session and
// checks ownership: an endpoint cannot be registered, listed or revoked across people.

const base64url = z
  .string()
  .min(8)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+={0,2}$/, "Not a push key.");

export const subscribeSchema = z.strictObject({
  endpoint: z
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "A push endpoint is an https address."),
  keys: z.strictObject({ p256dh: base64url, auth: base64url }),
  deviceId: z.uuid(),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;

export type SubscriptionDTO = {
  id: string;
  deviceId: string;
  label: string;
  createdAt: string;
  lastSeenAt: string;
};

/**
 * Saves a device's subscription. A device (one per person and device id) has one live subscription: a new endpoint
 * replaces the old. An endpoint that belongs to someone else is refused and logged, never reassigned: a shared
 * browser profile after sign-out must not deliver to the next person.
 */
export async function registerSubscription(
  userId: string,
  input: SubscribeInput,
  label: string,
): Promise<SubscriptionDTO> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint))
      .limit(1);
    if (existing && existing.userId !== userId) {
      logger.warn("push endpoint registered by another person", { userId, owner: existing.userId });
      throw new AppError("UNAUTHORIZED", "That device is registered to another account.");
    }

    const now = new Date();
    // Whatever else this device had live is replaced (its old endpoint stopped working or changed).
    await tx
      .update(pushSubscriptions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(pushSubscriptions.userId, userId),
          eq(pushSubscriptions.deviceId, input.deviceId),
          isNull(pushSubscriptions.revokedAt),
        ),
      );

    const values = {
      userId,
      deviceId: input.deviceId,
      endpoint: input.endpoint,
      p256dh: input.keys.p256dh,
      auth: input.keys.auth,
      userAgentLabel: label,
      lastSeenAt: now,
      revokedAt: null,
    };
    const [row] = existing
      ? await tx
          .update(pushSubscriptions)
          .set(values)
          .where(eq(pushSubscriptions.id, existing.id))
          .returning()
      : await tx.insert(pushSubscriptions).values(values).returning();
    return toDto(row!);
  });
}

function toDto(row: typeof pushSubscriptions.$inferSelect): SubscriptionDTO {
  return {
    id: row.id,
    deviceId: row.deviceId,
    label: row.userAgentLabel,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  };
}

/** The person's live devices, newest first. */
export async function listSubscriptions(userId: string): Promise<SubscriptionDTO[]> {
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)))
    .orderBy(desc(pushSubscriptions.createdAt));
  return rows.map(toDto);
}

/** Revokes one of the person's devices. Someone else's id is simply not found. */
export async function revokeSubscription(userId: string, id: string): Promise<void> {
  const rows = await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(pushSubscriptions.id, id),
        eq(pushSubscriptions.userId, userId),
        isNull(pushSubscriptions.revokedAt),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  if (rows.length === 0) throw new AppError("NOT_FOUND");
}

/** Signing out of a device unsubscribes it. Nothing to do (and no error) when it never subscribed. */
export async function revokeDevice(userId: string, deviceId: string): Promise<number> {
  const rows = await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.deviceId, deviceId),
        isNull(pushSubscriptions.revokedAt),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return rows.length;
}

/** The heartbeat of an open, focused tab: this device is looking at the app now. */
export async function touchDevice(userId: string, deviceId: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastSeenAt: new Date() })
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.deviceId, deviceId),
        isNull(pushSubscriptions.revokedAt),
      ),
    );
}

/** Live subscriptions to deliver to. */
export async function activeSubscriptions(userId: string) {
  return db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), isNull(pushSubscriptions.revokedAt)));
}

/** A subscription the push service said is gone (404 or 410). */
export async function markGone(id: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ revokedAt: new Date() })
    .where(and(eq(pushSubscriptions.id, id), isNull(pushSubscriptions.revokedAt)));
}
