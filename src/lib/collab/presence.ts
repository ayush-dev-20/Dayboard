// Presence helpers (V3 feature 05 §6): a stable colour and initials per person, so a name tag looks the same on every screen.

const COLORS = [
  "#1c5687",
  "#9a4a1f",
  "#2f6b3f",
  "#7a3b8f",
  "#a02b4c",
  "#4a5a12",
  "#0f6b73",
  "#5b4b9a",
] as const;

/** One of a small set of colours that all read on light and dark paper, chosen from the user id. */
export function presenceColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length]!;
}

export function presenceInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = [...words[0]!][0] ?? "?";
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? "") : "";
  return (first + last).toUpperCase();
}
