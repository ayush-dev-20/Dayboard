import { useSyncExternalStore } from "react";
import type { AttachmentDTO } from "@/lib/storage/dto";
import { isImageMime, validateDeclared } from "@/lib/storage/policy";
import type { OwnerType } from "@/lib/storage/types";
import { finalizeUpload, deleteFile, requestIntent } from "./api";
import { primeAttachments } from "./attachment-meta-store";

// Uploads in flight (V2 feature 09 §6): one entry per file with its progress, and the way to cancel
// or retry it. The file goes browser to storage with an XHR (the only way to see real upload
// progress), never through this app's server. The same store feeds the Attachments list and the
// image and file blocks, so a block shows its own progress while the file goes up.

export type UploadStatus = "uploading" | "finishing" | "done" | "failed" | "canceled";

export type Upload = {
  /** Also the attachment's id: chosen here so the block can point at it before it exists. */
  id: string;
  name: string;
  size: number;
  mime: string;
  ownerType: OwnerType;
  ownerId: string;
  status: UploadStatus;
  /** 0 to 1. */
  progress: number;
  /** What the row says when it failed ("Too large: max 10 MB"). */
  error: string | null;
  /** Set when the file is ready. */
  attachment: AttachmentDTO | null;
  isImage: boolean;
};

const uploads = new Map<string, Upload>();
const files = new Map<string, File>();
const requests = new Map<string, XMLHttpRequest>();
const listeners = new Set<() => void>();
let snapshot: ReadonlyMap<string, Upload> = new Map();

function publish() {
  snapshot = new Map(uploads);
  for (const listener of listeners) listener();
}

function update(id: string, patch: Partial<Upload>) {
  const current = uploads.get(id);
  if (!current) return;
  uploads.set(id, { ...current, ...patch });
  publish();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The upload for one attachment id (a block asks this to show progress), or undefined. */
export function useUpload(id: string): Upload | undefined {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.get(id),
    () => undefined,
  );
}

/** Every upload for one note, task or project. */
export function useUploadsFor(ownerType: OwnerType, ownerId: string | null): Upload[] {
  const all = useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => EMPTY,
  );
  return [...all.values()].filter((u) => u.ownerType === ownerType && u.ownerId === ownerId);
}
const EMPTY: ReadonlyMap<string, Upload> = new Map();

async function imageSize(file: File): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

function put(
  id: string,
  url: string,
  headers: Record<string, string>,
  file: File,
): Promise<{ ok: true } | { ok: false; aborted: boolean }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    requests.set(id, xhr);
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) update(id, { progress: event.loaded / event.total });
    };
    xhr.onload = () => {
      requests.delete(id);
      resolve(xhr.status >= 200 && xhr.status < 300 ? { ok: true } : { ok: false, aborted: false });
    };
    xhr.onerror = () => {
      requests.delete(id);
      resolve({ ok: false, aborted: false });
    };
    xhr.onabort = () => {
      requests.delete(id);
      resolve({ ok: false, aborted: true });
    };
    xhr.send(file);
  });
}

const fail = (id: string, error: string) => update(id, { status: "failed", error, progress: 0 });

async function run(id: string) {
  const file = files.get(id);
  const upload = uploads.get(id);
  if (!file || !upload) return;
  update(id, { status: "uploading", progress: 0, error: null });

  // The browser may not know a file's type (an empty `type`); the policy check already resolved it.
  const size = upload.isImage ? await imageSize(file) : null;
  const intent = await requestIntent({
    id,
    ownerType: upload.ownerType,
    ownerId: upload.ownerId,
    name: file.name,
    mime: upload.mime,
    size: file.size,
    width: size?.width ?? null,
    height: size?.height ?? null,
  });
  if (uploads.get(id)?.status === "canceled") return;
  if (!intent.ok) return fail(id, intent.message);
  // The server uses the suggested id unless someone else has it; a block already points at ours.
  if (intent.data.attachmentId !== id) return fail(id, "Couldn't upload. Retry.");

  const sent = await put(id, intent.data.upload.url, intent.data.upload.headers, file);
  if (!sent.ok) {
    if (sent.aborted || uploads.get(id)?.status === "canceled") return;
    return fail(id, "Couldn't upload. Check your connection and retry.");
  }

  update(id, { status: "finishing", progress: 1 });
  const done = await finalizeUpload(id);
  if (!done.ok) return fail(id, done.message);
  primeAttachments([done.data.attachment]);
  update(id, { status: "done", attachment: done.data.attachment, progress: 1 });
}

/**
 * Starts uploading a file for an owner and returns the attachment id at once, so a block can be
 * inserted while it goes up. A file that cannot be accepted fails on the spot, with the reason, and
 * nothing is sent.
 */
export function startUpload(file: File, owner: { type: OwnerType; id: string }): string {
  const id = crypto.randomUUID();
  const checked = validateDeclared({ name: file.name, mime: file.type, size: file.size });
  uploads.set(id, {
    id,
    name: file.name,
    size: file.size,
    mime: checked.ok ? checked.mime : file.type,
    ownerType: owner.type,
    ownerId: owner.id,
    status: checked.ok ? "uploading" : "failed",
    progress: 0,
    error: checked.ok ? null : checked.message,
    attachment: null,
    isImage: checked.ok && isImageMime(checked.mime),
  });
  files.set(id, file);
  publish();
  if (checked.ok) void run(id);
  return id;
}

/** Tries a failed upload again with the same id (the server keeps the unfinished one). */
export function retryUpload(id: string) {
  const upload = uploads.get(id);
  if (!upload || upload.status !== "failed") return;
  // A file that was refused before any request can't be retried: pick another.
  if (!validateDeclared({ name: upload.name, mime: upload.mime, size: upload.size }).ok) return;
  void run(id);
}

export function cancelUpload(id: string) {
  const upload = uploads.get(id);
  if (!upload || upload.status === "done") return;
  update(id, { status: "canceled", error: null });
  requests.get(id)?.abort();
  // Whatever the server started is removed; a file that never got that far has nothing to remove.
  void deleteFile(id);
}

/** Takes a finished, failed or canceled upload off the list. */
export function dismissUpload(id: string) {
  uploads.delete(id);
  files.delete(id);
  publish();
}

