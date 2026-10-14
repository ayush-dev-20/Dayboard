import "server-only";
import { env } from "@/lib/env";
import { keyFromBase64, TokenCryptoError, type KeyRing } from "./crypto";

/** The keys that seal and open refresh tokens, from the environment. Never cached with a value in a log. */
export function calendarKeys(): KeyRing {
  if (!env.TOKEN_ENCRYPTION_KEY) throw new TokenCryptoError("TOKEN_ENCRYPTION_KEY is not set.");
  return {
    current: keyFromBase64(env.TOKEN_ENCRYPTION_KEY),
    previous: env.TOKEN_ENCRYPTION_KEY_PREVIOUS
      ? keyFromBase64(env.TOKEN_ENCRYPTION_KEY_PREVIOUS)
      : undefined,
  };
}
