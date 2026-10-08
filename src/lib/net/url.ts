import { createHash } from "node:crypto";

// The one form a web address is kept in for previews (V2 feature 09 §2): `http` or `https`, no
// credentials, lower-case host, no fragment, the default port dropped. Tracking parameters are kept
// (they are part of the address). Pure.

export function normalizeUrl(raw: string): string | null {
  const text = raw.trim();
  if (!text || text.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  url.hash = "";
  return url.toString();
}

export const urlHash = (normalized: string) =>
  createHash("sha256").update(normalized).digest("hex");
