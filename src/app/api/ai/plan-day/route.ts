import { streamText } from "@/lib/ai";
import { aiRoute, ndjsonResponse, openGate } from "@/lib/ai/gate";
import { PlanCollector, type PlanRecord } from "@/lib/ai/plan";
import { planDayPrompt, planDaySystem } from "@/lib/ai/prompts";
import { AppError } from "@/lib/errors";
import { loadPlanCandidates } from "@/db/queries/ai";
import { planDayRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// B. Plan my day: the model picks 3 to 5 of the person's own open tasks and says why, one JSON
// object per line. Each line is checked against the tasks we sent; what the person sees (title, date,
// priority) is built here from our own data. Nothing is written until they confirm in the dialog.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx } = await openGate(request, "PLAN_DAY", planDayRequestSchema);
    const prefs = { timezone: ctx.timezone, startOfDay: ctx.prefs.startOfDay.slice(0, 5) };
    const candidates = await loadPlanCandidates(ctx.user.id, prefs);

    return ndjsonResponse(async (send) => {
      // A clear day needs no model and uses no quota: the stream just ends with no proposals.
      if (candidates.length === 0) return;

      const byId = new Map(candidates.map((c) => [c.taskId, c]));
      const collector = new PlanCollector(new Set(byId.keys()));
      const emit = (records: PlanRecord[]) => {
        for (const record of records) {
          if (record.kind === "summary") {
            send({ type: "summary", text: record.text });
            continue;
          }
          const task = byId.get(record.taskId)!;
          send({
            type: "proposal",
            item: {
              taskId: task.taskId,
              title: task.title,
              emoji: task.emoji,
              dueDate: task.dueDate,
              priority: task.priority,
              project: task.project,
              reason: record.reason,
            },
          });
        }
      };

      const session = streamText({
        userId: ctx.user.id,
        feature: "PLAN_DAY",
        system: planDaySystem,
        prompt: planDayPrompt(
          candidates.map((c) => ({
            id: c.taskId,
            title: c.title,
            dueDate: c.dueDate,
            priority: c.priority,
            status: c.status,
            project: c.project,
            subtasksDone: c.subtasksDone,
            subtasksTotal: c.subtasksTotal,
          })),
          ctx.today,
          ctx.timezone,
        ),
        fixture: {
          today: ctx.today,
          candidates: candidates.map((c) => ({ id: c.taskId, dueDate: c.dueDate, title: c.title })),
        },
        signal: request.signal,
      });

      let ok = false;
      try {
        for await (const delta of session.chunks) emit(collector.push(delta));
        emit(collector.end());
        ok = true;
      } finally {
        await session.finish(ok);
      }

      // A plan with nothing usable in it is a failure, not an empty day.
      if (collector.proposals === 0 && !request.signal.aborted) {
        throw new AppError("AI_PROVIDER_ERROR");
      }
    });
  });
}
