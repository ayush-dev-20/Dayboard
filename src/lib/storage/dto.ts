import { categoryOf, type FileCategory } from "./policy";
import type { OwnerType } from "./types";

// An attachment as the UI sees it (V2 feature 09 §4): metadata only, never a storage key.
export type AttachmentDTO = {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  category: FileCategory;
};

export type IntentResult = {
  attachmentId: string;
  upload: { url: string; headers: Record<string, string> };
  expiresAt: string;
};

export type StorageUsage = {
  /** Whether files are switched on at all. */
  available: boolean;
  usedBytes: number;
  quotaBytes: number;
};

export function toAttachmentDTO(row: {
  id: string;
  ownerType: OwnerType;
  ownerId: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: Date;
}): AttachmentDTO {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    name: row.originalName,
    mime: row.mimeType,
    size: row.sizeBytes,
    width: row.width,
    height: row.height,
    createdAt: row.createdAt.toISOString(),
    category: categoryOf(row.mimeType) ?? "document",
  };
}

/** The address a file is read from (the app checks the session, then redirects to storage). */
export const fileUrl = (id: string, options: { download?: boolean } = {}) =>
  `/api/files/${id}${options.download ? "?download=1" : ""}`;
