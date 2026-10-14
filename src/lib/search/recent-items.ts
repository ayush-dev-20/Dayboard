// The items the person opened last, kept in this browser only (localStorage), at most 8. Only the type and id
// are stored, never a title. Storage can be missing or blocked, so every call is wrapped and a failure just
// means no history. The server decides which of these still exist (V2 feature 10 §2 and §6).

const KEY = "dayboard:recent-items";
export const MAX_RECENT_ITEMS = 8;

export const RECENT_TYPES = ["task", "note", "project"] as const;
export type RecentType = (typeof RECENT_TYPES)[number];
export type RecentRef = { type: RecentType; id: string; openedAt: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(value: unknown): RecentRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: RecentRef[] = [];
  for (const raw of value) {
    const r = raw as Partial<RecentRef> | null;
    if (!r || !(RECENT_TYPES as readonly string[]).includes(r.type ?? "")) continue;
    if (typeof r.id !== "string" || !UUID.test(r.id)) continue;
    const key = `${r.type}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type: r.type as RecentType,
      id: r.id,
      openedAt: typeof r.openedAt === "number" ? r.openedAt : 0,
    });
  }
  return out.slice(0, MAX_RECENT_ITEMS);
}

export function readRecentItems(): RecentRef[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Puts the item first (it moves up if it is already there). */
export function rememberOpened(type: RecentType, id: string, now: number = Date.now()): void {
  try {
    const next = clean([
      { type, id, openedAt: now },
      ...readRecentItems().filter((r) => !(r.type === type && r.id === id)),
    ]);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

/** Drops items the server said no longer exist. */
export function pruneRecentItems(keep: { type: RecentType; id: string }[]): void {
  try {
    const wanted = new Set(keep.map((k) => `${k.type}:${k.id}`));
    const next = readRecentItems().filter((r) => wanted.has(`${r.type}:${r.id}`));
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function forgetRecentItems(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** The `open=` value for `GET /api/search?recent=1`: `task:<id>,note:<id>`. */
export function openParam(refs: RecentRef[]): string {
  return refs.map((r) => `${r.type}:${r.id}`).join(",");
}

/** Reads that value back on the server. Anything malformed is ignored; at most 8 refs are kept. */
export function parseOpenParam(
  value: string | null | undefined,
): { type: RecentType; id: string }[] {
  const out: { type: RecentType; id: string }[] = [];
  const seen = new Set<string>();
  for (const part of (value ?? "").split(",")) {
    const [type, id] = part.trim().split(":");
    if (!type || !id || !(RECENT_TYPES as readonly string[]).includes(type) || !UUID.test(id))
      continue;
    const key = `${type}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: type as RecentType, id });
    if (out.length >= MAX_RECENT_ITEMS) break;
  }
  return out;
}
