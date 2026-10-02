import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { estimateSchema, nextStepsSchema, rewriteSchema } from "@/lib/ai/schemas";
import { loadTask } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { taskAssistRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// Task detail actions. Rewrite and Clarify return a proposal for Replace / Discard; Estimate is
// shown only and never saved; Next steps can each become a subtask on click.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "TASK_ASSIST", taskAssistRequestSchema);
    const task = await loadTask(ctx.user.id, input.taskId);
    if (!task) throw new AppError("NOT_FOUND");

    const common = {
      userId: ctx.user.id,
      feature: "TASK_ASSIST" as const,
      system: systemPrompts.TASK_ASSIST[input.mode],
      prompt: buildPrompt.taskAssist(task, ctx.today, ctx.timezone),
      fixture: { mode: input.mode, task },
    };

    switch (input.mode) {
      case "REWRITE_DESCRIPTION":
      case "CLARIFY": {
        const out = await generateStructured({ ...common, schema: rewriteSchema });
        return jsonOk({
          mode: input.mode,
          title: input.mode === "CLARIFY" ? (out.title ?? null) : null,
          description: out.description,
        });
      }
      case "ESTIMATE": {
        const out = await generateStructured({ ...common, schema: estimateSchema });
        return jsonOk({ mode: input.mode, ...out });
      }
      case "NEXT_STEPS": {
        const out = await generateStructured({ ...common, schema: nextStepsSchema });
        return jsonOk({ mode: input.mode, steps: out.steps });
      }
    }
  });
}
