// The two storage limits (V2 feature 09 §3.8, §5): per person, and for everyone together (which
// keeps the total under the provider's free tier). Both count READY and PENDING files. A file
// that brings the total exactly to a limit is allowed; one byte over is not. Pure.

export type QuotaVerdict =
  { ok: true } | { ok: false; code: "QUOTA_EXCEEDED" | "STORAGE_FULL"; message: string };

export const QUOTA_MESSAGE = "You've used all your storage. Delete some files to upload more.";
export const FULL_MESSAGE = "Uploads are paused because storage is full.";

export function checkLimits(input: {
  personBytes: number;
  totalBytes: number;
  addingBytes: number;
  personLimitBytes: number;
  totalLimitBytes: number;
}): QuotaVerdict {
  // The whole-service limit comes first: when storage is full, nobody can upload, whatever their
  // own usage.
  if (input.totalBytes + input.addingBytes > input.totalLimitBytes) {
    return { ok: false, code: "STORAGE_FULL", message: FULL_MESSAGE };
  }
  if (input.personBytes + input.addingBytes > input.personLimitBytes) {
    return { ok: false, code: "QUOTA_EXCEEDED", message: QUOTA_MESSAGE };
  }
  return { ok: true };
}
