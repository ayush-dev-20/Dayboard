import type { VoiceCaptureDetail, VoiceCaptureDTO, VoiceIntentResult } from "../types";

// The browser's side of the voice routes (V2 feature 13 §8). Each call answers with a plain result; a
// failed request never throws, so the recorder can say "Saved on this device" instead of breaking.

export type ApiFailure = { ok: false; code: string; message: string };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

async function call<T>(path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
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

const post = <T>(path: string, body?: unknown) =>
  call<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

export type IntentBody = { id: string; mimeType: string; sizeBytes: number; durationMs: number };

export const requestIntent = (body: IntentBody) =>
  post<VoiceIntentResult>("/api/voice/captures", body);

export const finalizeCapture = (id: string) =>
  post<{ capture: VoiceCaptureDTO }>(`/api/voice/captures/${id}/finalize`);

export const retryCapture = (id: string) =>
  post<{ capture: VoiceCaptureDTO }>(`/api/voice/captures/${id}/retry`);

export const getCapture = (id: string) =>
  call<{ capture: VoiceCaptureDetail }>(`/api/voice/captures/${id}`);

export const listCaptures = () => call<{ captures: VoiceCaptureDTO[] }>("/api/voice/captures");

export const discardCapture = (id: string) =>
  call<{ ok: true }>(`/api/voice/captures/${id}`, { method: "DELETE" });

export const audioUrl = (id: string) => `/api/voice/captures/${id}/audio`;

/** The file goes straight to storage with the headers the intent returned. Never throws. */
export async function putAudio(
  upload: { url: string; headers: Record<string, string> },
  blob: Blob,
): Promise<ApiResult<null>> {
  try {
    const response = await fetch(upload.url, {
      method: "PUT",
      headers: upload.headers,
      body: blob,
    });
    if (response.ok) return { ok: true, data: null };
    return { ok: false, code: "UPLOAD_FAILED", message: "The upload didn't go through." };
  } catch {
    return { ok: false, code: "NETWORK", message: "You appear to be offline." };
  }
}
