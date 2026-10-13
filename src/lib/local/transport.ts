import type { PullPage, PushOutcome, Transport, WireOperation } from "./engine";

// The browser's side of the sync endpoints (V2 feature 05 §3). Throws when there is no answer, so the
// engine knows to wait.

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return (await response.json()) as T;
}

export const httpTransport: Transport = {
  push(body: { deviceId: string; appVersion: string; ops: WireOperation[] }) {
    return call<{ results: PushOutcome[] }>("/api/sync/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  },
  pull(cursor: number, limit: number) {
    return call<PullPage>(`/api/sync/pull?cursor=${cursor}&limit=${limit}`, { method: "GET" });
  },
};
