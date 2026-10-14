import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Refresh tokens at rest (V2 feature 12 §2). AES-256-GCM, one random IV per token, and the token's owner
// bound in as additional data so a ciphertext copied to another row will not open. The format names the key
// that sealed it, so a key can be rotated: the old key stays readable until every token is re-sealed.
//
//   v1.<keyId>.<iv>.<ciphertext>.<tag>      (base64url parts)

export type KeyRing = { current: Buffer; previous?: Buffer };

export class TokenCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenCryptoError";
  }
}

/** A short public name for a key (the start of its hash), never the key. */
export function keyIdOf(key: Buffer): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new TokenCryptoError("The encryption key must be 32 bytes.");
  return key;
}

/** `context` ties the token to its owner (for example `userId:accountId`). Use the same value to open it. */
export function sealToken(plain: string, keys: KeyRing, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys.current, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    keyIdOf(keys.current),
    ...[iv, body, tag].map((part) => part.toString("base64url")),
  ].join(".");
}

export function openToken(sealed: string, keys: KeyRing, context: string): string {
  const parts = sealed.split(".");
  if (parts.length !== 5 || parts[0] !== "v1") throw new TokenCryptoError("Unreadable token.");
  const [, id, iv, body, tag] = parts as [string, string, string, string, string];
  const key = [keys.current, keys.previous].find((k) => k && keyIdOf(k) === id);
  if (!key) throw new TokenCryptoError("The key this token was sealed with is not available.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    // Wrong context, a changed byte, or a damaged value all look the same, on purpose.
    throw new TokenCryptoError("The token could not be opened.");
  }
}

/** True when the token was sealed with something other than the current key, so it should be re-sealed. */
export function needsResealing(sealed: string, keys: KeyRing): boolean {
  return sealed.split(".")[1] !== keyIdOf(keys.current);
}
