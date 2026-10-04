// Plan my day streams one JSON object per line (feature 08 §6.2). This reads those lines as they
// arrive and keeps only what can be trusted: tasks we actually sent, once each, at most five.

export const MAX_PLAN_TASKS = 5;
const MAX_REASON = 100;
const MAX_SUMMARY = 200;

export type PlanRecord =
  { kind: "summary"; text: string } | { kind: "proposal"; taskId: string; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cut = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
};

/** One line → a record, or null if it isn't one (a code fence, prose, bad JSON, wrong shape). */
export function parsePlanLine(line: string): PlanRecord | null {
  const text = line.trim().replace(/,$/, "");
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const o = value as Record<string, unknown>;

  if (typeof o.summary === "string" && o.summary.trim() && o.taskId === undefined) {
    return { kind: "summary", text: cut(o.summary, MAX_SUMMARY) };
  }
  if (typeof o.taskId === "string" && UUID.test(o.taskId)) {
    const reason = typeof o.reason === "string" ? cut(o.reason, MAX_REASON) : "";
    return { kind: "proposal", taskId: o.taskId.toLowerCase(), reason };
  }
  return null;
}

/**
 * Feed it text as it arrives. It returns the records that became complete (a line is complete at its
 * newline, or at the end of the stream). Unknown or repeated task ids and anything past the fifth
 * proposal are dropped, a malformed line is skipped, and only the first summary counts.
 */
export class PlanCollector {
  private pending = "";
  private seen = new Set<string>();
  private summarized = false;
  proposals = 0;

  constructor(
    private readonly allowed: ReadonlySet<string>,
    private readonly max = MAX_PLAN_TASKS,
  ) {}

  private take(line: string): PlanRecord | null {
    const record = parsePlanLine(line);
    if (!record) return null;
    if (record.kind === "summary") {
      if (this.summarized) return null;
      this.summarized = true;
      return record;
    }
    if (!this.allowed.has(record.taskId) || this.seen.has(record.taskId)) return null;
    if (this.proposals >= this.max) return null;
    this.seen.add(record.taskId);
    this.proposals += 1;
    return record;
  }

  push(chunk: string): PlanRecord[] {
    this.pending += chunk;
    const lines = this.pending.split("\n");
    this.pending = lines.pop() ?? "";
    return lines.flatMap((l) => this.take(l) ?? []);
  }

  /** The stream is over: the last line, if any, is complete too. */
  end(): PlanRecord[] {
    const last = this.pending;
    this.pending = "";
    const record = last ? this.take(last) : null;
    return record ? [record] : [];
  }
}
