import type { AttachmentDTO, IntentResult } from "@/lib/storage/dto";
import type { OwnerType } from "@/lib/storage/types";
import type { PreviewDTO } from "@/db/mutations/link-previews";

// The browser's side of the file routes (V2 feature 09 §4). Each call answers with a plain result;
// a failed request never throws, so a row can show "Couldn't upload. Retry" instead of breaking.

export type ApiFailure = { ok: false; code: string; message: string };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

async function call<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    return { ok: false, code: "NETWORK", message: "You appear to be offline." };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON answer: the status says enough.
  }
  if (response.ok) return { ok: true, data: body as T };
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    ok: false,
    code: error?.code ?? "INTERNAL_ERROR",
    message: error?.message ?? "Something went wrong on our side. Try again.",
  };
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

export type IntentBody = {
  id?: string;
  ownerType: OwnerType;
  ownerId: string;
  name: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
};

export const requestIntent = (body: IntentBody) => post<IntentResult>("/api/files/intent", body);

export const finalizeUpload = (id: string) =>
  post<{ attachment: AttachmentDTO }>("/api/files/finalize", { id });

export const deleteFile = (id: string) =>
  call<{ ok: true }>(`/api/files/${id}`, { method: "DELETE" });

export const listFiles = (ownerType: OwnerType, ownerId: string) =>
  call<{ attachments: AttachmentDTO[] }>(
    `/api/files?ownerType=${ownerType}&ownerId=${encodeURIComponent(ownerId)}`,
    { method: "GET" },
  );

export const fetchFileMeta = (ids: string[]) =>
  post<{ files: AttachmentDTO[] }>("/api/files/meta", { ids });

export const fetchLinkPreview = (url: string, refresh = false) =>
  post<{ preview: PreviewDTO }>("/api/link-preview", { url, refresh });
