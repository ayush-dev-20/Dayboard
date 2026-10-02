// Recent searches live in this browser only (localStorage), the last 8. Storage can be missing or
// blocked, so every call is wrapped and a failure just means no history.
const KEY = "dayboard:recent-searches";
const MAX = 8;

export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX)
      : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): void {
  const q = query.trim();
  if (q.length < 2) return;
  try {
    const next = [
      q,
      ...readRecentSearches().filter((x) => x.toLowerCase() !== q.toLowerCase()),
    ].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

export function forgetSearches(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
