import { addDays } from "@/lib/dates/calendar";
import { resolveDuePhrase } from "@/lib/dates/resolve";
import type { OverdueAction, OverdueCleanupOutput } from "./schemas";

export type OverdueTaskInfo = { id: string; title: string; dueDate: string; priority: string };

export type OverdueProposal = {
  taskId: string;
  title: string;
  dueDate: string;
  action: OverdueAction;
  /** Only for RESCHEDULE: "YYYY-MM-DD". */
  newDueDate: string | null;
  reason: string;
};

/**
 * Keeps only proposals for tasks that were actually sent (an id the model made up, or one that
 * belongs to someone else, is dropped), one per task, and gives every RESCHEDULE a real date that
 * is after today.
 */
export function sanitizeProposals(
  output: OverdueCleanupOutput,
  sent: OverdueTaskInfo[],
  today: string,
): OverdueProposal[] {
  const byId = new Map(sent.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const out: OverdueProposal[] = [];
  for (const p of output.proposals) {
    const task = byId.get(p.taskId);
    if (!task || seen.has(p.taskId)) continue;
    seen.add(p.taskId);
    let newDueDate: string | null = null;
    if (p.action === "RESCHEDULE") {
      const resolved = resolveDuePhrase(p.newDueDate, today);
      newDueDate = resolved && resolved > today ? resolved : addDays(today, 1);
    }
    out.push({
      taskId: task.id,
      title: task.title,
      dueDate: task.dueDate,
      action: p.action,
      newDueDate,
      reason: p.reason,
    });
  }
  return out;
}
