import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { sanitizeProposals } from "@/lib/ai/overdue";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { overdueCleanupSchema } from "@/lib/ai/schemas";
import { loadOverdueTasks } from "@/db/queries/ai";
import { overdueCleanupRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// G. Overdue cleanup: a proposal per overdue task. Each accepted row is applied afterwards with
// the ordinary task actions, one call per row; this route changes nothing.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx } = await openGate(request, "OVERDUE_CLEANUP", overdueCleanupRequestSchema);
    const tasks = await loadOverdueTasks(ctx.user.id, {
      timezone: ctx.timezone,
      startOfDay: ctx.prefs.startOfDay,
    });
    if (tasks.length === 0) return jsonOk({ proposals: [] });

    const output = await generateStructured({
      userId: ctx.user.id,
      feature: "OVERDUE_CLEANUP",
      system: systemPrompts.OVERDUE_CLEANUP,
      prompt: buildPrompt.overdue(tasks, ctx.today, ctx.timezone),
      schema: overdueCleanupSchema,
      fixture: { tasks, today: ctx.today },
    });
    return jsonOk({ proposals: sanitizeProposals(output, tasks, ctx.today) });
  });
}
