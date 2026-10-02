import { resolveDuePhrase } from "@/lib/dates/resolve";
import type { ExtractedTask } from "./schemas";

export type PreviewTask = {
  title: string;
  /** "YYYY-MM-DD" or null. A phrase the server could not resolve becomes null, never a guess. */
  dueDate: string | null;
  owner: string | null;
  evidence: string | null;
};

/**
 * Cleans what the model found before it reaches the preview: resolves relative due dates in the
 * person's own day, drops repeats (same title ignoring case), and keeps at most `max` items.
 */
export function toPreviewTasks(items: ExtractedTask[], today: string, max = 15): PreviewTask[] {
  const seen = new Set<string>();
  const out: PreviewTask[] = [];
  for (const item of items) {
    const key = item.title.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: item.title,
      dueDate: resolveDuePhrase(item.dueDate, today),
      owner: item.owner ?? null,
      evidence: item.evidence ?? null,
    });
    if (out.length >= max) break;
  }
  return out;
}
