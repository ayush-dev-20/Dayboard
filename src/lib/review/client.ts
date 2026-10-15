import type { ReviewDTO } from "./types";

// The browser's side of the review routes (V2 feature 15 §7). Each call answers with a plain result; a failed
// request never throws, so a button can say "Couldn't make that. Try again" instead of breaking.

export type ApiFailure = { ok: false; code: string; message: string };
export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

async function post<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    return {
      ok: false,
      code: "NETWORK",
      message: "You appear to be offline. Generating needs a connection.",
    };
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    // Not JSON: the status says enough.
  }
  if (response.ok) return { ok: true, data: json as T };
  const error = (json as { error?: { code?: string; message?: string } } | null)?.error;
  return {
    ok: false,
    code: error?.code ?? "INTERNAL_ERROR",
    message: error?.message ?? "Something went wrong on our side. Try again.",
  };
}

export type GenerateAnswer = {
  review: ReviewDTO | null;
  outcome: "CREATED" | "EXISTS" | "KEPT_FINAL" | "EMPTY";
};

export const generateNow = () => post<GenerateAnswer>("/api/review/generate", {});

export const addSuggestionsFor = (weekStart: string) =>
  post<{ review: ReviewDTO }>(`/api/review/${weekStart}/suggestions`, {});
