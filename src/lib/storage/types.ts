// The one interface the rest of the app sees for object storage (V2 feature 09 §3). The provider's
// SDK is imported in `s3.ts` and nowhere else.

export type StorageService = {
  /** A short-lived URL the browser PUTs the file to. The `headers` must be sent unchanged. */
  createUploadUrl(
    key: string,
    options: { mime: string; size: number; expiresIn: number },
  ): Promise<{ url: string; headers: Record<string, string> }>;
  /** A short-lived URL that serves the file with the given type and file name. */
  createDownloadUrl(
    key: string,
    options: {
      filename: string;
      disposition: "inline" | "attachment";
      mime: string;
      expiresIn: number;
    },
  ): Promise<string>;
  /** The stored size and type, or null when there is no such object. */
  head(key: string): Promise<{ size: number; mime: string } | null>;
  /** The first `bytes` bytes (for checking what a file really is). */
  readHead(key: string, bytes: number): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
};

export type StorageSettings = {
  /** Seconds a presigned upload URL lives. */
  uploadExpiresIn: number;
  /** Seconds a presigned download URL lives. */
  downloadExpiresIn: number;
};

export const STORAGE_SETTINGS: StorageSettings = { uploadExpiresIn: 300, downloadExpiresIn: 60 };

export const OWNER_TYPES = ["NOTE", "TASK", "PROJECT"] as const;
export type OwnerType = (typeof OWNER_TYPES)[number];
