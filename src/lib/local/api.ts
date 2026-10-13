import type {
  SnapshotEntity,
  SnapshotPage,
  SnapshotPreferences,
  SnapshotTask,
} from "@/lib/sync/snapshot";

// The browser's calls to the bootstrap endpoint (V2 feature 04 §8).

async function getPage<T>(entity: SnapshotEntity, cursor: string | null): Promise<SnapshotPage<T>> {
  const params = new URLSearchParams({ entity, limit: "500" });
  if (cursor) params.set("cursor", cursor);
  const response = await fetch(`/api/sync/snapshot?${params.toString()}`, {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(`Snapshot failed with ${response.status}`);
  return (await response.json()) as SnapshotPage<T>;
}

export const fetchTaskPage = (cursor: string | null) => getPage<SnapshotTask>("tasks", cursor);

export const fetchPreferencesPage = () => getPage<SnapshotPreferences>("preferences", null);
