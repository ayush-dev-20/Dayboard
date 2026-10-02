export const MAX_TAGS_PER_ITEM = 10;
export const MAX_TAG_NAME = 40;

/**
 * What decides whether two tags are "the same": trimmed, lower-cased, inner whitespace collapsed.
 * "  Client   Work " and "client work" are one tag; the person's own casing is kept for display.
 */
export function normalizeTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The name as shown: trimmed with inner whitespace collapsed, casing untouched. */
export function cleanTagName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

import type { ColorToken } from "./colors";

export type TagDTO = { id: string; name: string; color: ColorToken | null };

export type TagWithUsageDTO = TagDTO & { taskCount: number; noteCount: number };
