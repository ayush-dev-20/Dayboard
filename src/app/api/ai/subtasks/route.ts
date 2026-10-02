import { generateStructured } from "@/lib/ai";
import { aiRoute, jsonOk, openGate } from "@/lib/ai/gate";
import { buildPrompt, systemPrompts } from "@/lib/ai/prompts";
import { subtasksSchema } from "@/lib/ai/schemas";
import { loadTask } from "@/db/queries/ai";
import { AppError } from "@/lib/errors";
import { subtasksRequestSchema } from "@/lib/validations/ai";

export const dynamic = "force-dynamic";

// B. Break a task into 3 to 8 subtasks. A preview only; "Add N subtasks" creates them.
export async function POST(request: Request) {
  return aiRoute(async () => {
    const { ctx, input } = await openGate(request, "SUBTASKS", subtasksRequestSchema);
    const task = await loadTask(ctx.user.id, input.taskId);
    if (!task) throw new AppError("NOT_FOUND");
    if (task.parentTaskId) throw new AppError("VALIDATION_ERROR", "Subtasks can't have subtasks.");

    const output = await generateStructured({
      userId: ctx.user.id,
      feature: "SUBTASKS",
      system: systemPrompts.SUBTASKS,
      prompt: buildPrompt.subtasks(task),
      schema: subtasksSchema,
      fixture: { title: task.title },
    });
    // Drop repeats and anything that matches an existing subtask.
    const existing = new Set(task.subtasks.map((s) => s.toLocaleLowerCase()));
    const seen = new Set<string>();
    const subtasks = output.subtasks.filter((s) => {
      const key = s.title.toLocaleLowerCase();
      if (existing.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return jsonOk({ subtasks });
  });
}
