import "server-only";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Tells the collaboration service to check access now (V3 feature 05 §3): after a share is removed, a role changes, sharing
 * stops or a person leaves. A no-op when the service is not configured. The service re-checks every minute anyway, so a
 * failure here only delays the disconnect; it never fails the action that caused it.
 */
export async function recheckCollabAccess(noteIds?: string[]): Promise<void> {
  if (!env.collabEnabled || !env.COLLAB_INTERNAL_SECRET) return;
  try {
    await fetch(`${env.collabInternalUrl}/internal/recheck`, {
      method: "POST",
      headers: {
        "x-collab-secret": env.COLLAB_INTERNAL_SECRET,
        "content-type": "application/json",
      },
      body: JSON.stringify({ noteIds }),
      signal: AbortSignal.timeout(2000),
    });
  } catch (error) {
    logger.warn("collab recheck request failed", {
      error: error instanceof Error ? error.name : "unknown",
    });
  }
}
