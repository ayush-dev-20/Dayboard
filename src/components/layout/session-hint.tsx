"use client";

import { useEffect } from "react";
import { writeSessionHint } from "@/lib/local/session-hint";

/**
 * Tells the offline app who is signed in and until when (V2 feature 04 §0). Written on every signed-in
 * page load, so the expiry follows the session as it is renewed. Renders nothing.
 */
export function SessionHint({ userId, expiresAt }: { userId: string; expiresAt: string }) {
  useEffect(() => {
    writeSessionHint({ userId, expiresAt });
  }, [userId, expiresAt]);
  return null;
}
