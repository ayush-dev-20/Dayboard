import { createHash, timingSafeEqual } from "node:crypto";

/** Compares two secrets in constant time. Both are hashed first, so the comparison never depends on lengths. */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
