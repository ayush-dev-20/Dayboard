import "server-only";
import { createHash } from "node:crypto";

// A fingerprint of what an operation asks for (V2 feature 05 §2). A retry with the same op id must carry
// the same content; if it does not, the server refuses it. The payload itself is not stored.

/** JSON with keys in a fixed order, so the same content always gives the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      );
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function payloadHash(input: { type: string; entityId: string; payload: unknown }): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}
